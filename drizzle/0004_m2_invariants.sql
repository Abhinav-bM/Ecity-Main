-- M2 invariants enforced by the database, not only by application code.
-- Validation in TypeScript can be bypassed by an import, a script or a bug.
-- A constraint cannot. (docs/03 §4.4, §4.3)

-- 1. NEW CUT is a designation INSIDE GLOBAL, never a sixth main type.
--    PRD §5.1 / FR-5.2.
ALTER TABLE "device_unit"
  ADD CONSTRAINT "new_cut_only_global"
  CHECK ("is_new_cut" = false OR "main_type" = 'GLOBAL');

-- New-cut notes are meaningless unless the device is actually new cut.
ALTER TABLE "device_unit"
  ADD CONSTRAINT "new_cut_notes_need_new_cut"
  CHECK ("new_cut_notes" IS NULL OR "is_new_cut" = true);

-- 2. Stock can never go negative. A bug that oversells must fail loudly at
--    the database rather than quietly produce -3 units.
ALTER TABLE "branch_stock"
  ADD CONSTRAINT "branch_stock_quantity_non_negative"
  CHECK ("quantity" >= 0);

ALTER TABLE "branch_stock"
  ADD CONSTRAINT "branch_stock_min_quantity_non_negative"
  CHECK ("min_quantity" >= 0);

-- 3. Money is never negative, and is always integer paise.
ALTER TABLE "device_unit"
  ADD CONSTRAINT "device_prices_non_negative"
  CHECK (
    ("purchase_price_paise" IS NULL OR "purchase_price_paise" >= 0) AND
    ("selling_price_paise" IS NULL OR "selling_price_paise" >= 0)
  );

-- 4. Exactly one primary identifier per device (PRD FR-4.10).
CREATE UNIQUE INDEX "device_identifier_one_primary"
  ON "device_identifier" ("device_id") WHERE "is_primary";

-- 5. An IMEI is 14-17 digits. Rejects a scanner that read a barcode instead.
ALTER TABLE "device_identifier"
  ADD CONSTRAINT "imei_digits"
  CHECK ("imei" ~ '^[0-9]{14,17}$');

-- 6. device_event is append-only. The IMEI history in PRD FR-30 is only
--    trustworthy if nothing can rewrite it.
CREATE OR REPLACE FUNCTION device_event_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'device_event is append-only: % is not permitted', TG_OP
    USING HINT = 'A device history is never edited. Append a correcting event.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS device_event_no_update ON device_event;
CREATE TRIGGER device_event_no_update
  BEFORE UPDATE ON device_event
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();

DROP TRIGGER IF EXISTS device_event_no_delete ON device_event;
CREATE TRIGGER device_event_no_delete
  BEFORE DELETE ON device_event
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();

-- The same for stock_ledger: a running total is only auditable if its
-- movements cannot be rewritten.
DROP TRIGGER IF EXISTS stock_ledger_no_update ON stock_ledger;
CREATE TRIGGER stock_ledger_no_update
  BEFORE UPDATE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();

DROP TRIGGER IF EXISTS stock_ledger_no_delete ON stock_ledger;
CREATE TRIGGER stock_ledger_no_delete
  BEFORE DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();

-- 7. Partial-IMEI and name search (docs/03 §4.7). pg_trgm was created in 0001.
CREATE INDEX "device_identifier_imei_trgm"
  ON "device_identifier" USING gin ("imei" gin_trgm_ops);

CREATE INDEX "product_name_trgm"
  ON "product" USING gin ("name" gin_trgm_ops);
