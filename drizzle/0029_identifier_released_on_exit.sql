-- An IMEI is claimed by the device that currently HOLDS it, not forever.
--
-- `device_identifier_value_uq` was unique across every row that has ever
-- existed, so a handset the shop sold two years ago kept its number reserved
-- for good. Buying that same handset back - a trade-in, an exchange, a
-- customer returning to sell it on - was refused with "already belongs to",
-- naming a device that has not been in the shop since.
--
-- The rule the shop actually needs is narrower: **two devices may not hold the
-- same identifier at the same time.** Once a unit has left - sold, written off
-- as lost, or voided by a reversed purchase - the number is free again, and
-- the old device keeps its identifiers so warranty, returns and IMEI history
-- still resolve against it.
--
-- `released_at` is what the partial unique index below keys on. NULL means
-- "this row still claims the number".

ALTER TABLE "device_identifier"
  ADD COLUMN "released_at" timestamp with time zone;

-- Existing rows: release the identifiers of anything not currently in hand.
-- Safe to run against the old global index - it guaranteed no duplicates, so
-- nothing here can collide.
UPDATE "device_identifier" di
SET "released_at" = now()
FROM "device_unit" du
WHERE du."id" = di."device_id"
  AND du."status" IN ('SOLD', 'SOLD_PENDING_IMPORT', 'VOIDED', 'LOST');

DROP INDEX "device_identifier_value_uq";

-- The claim, enforced by the database rather than by application code alone.
-- Two concurrent purchases of the same IMEI cannot both win this.
CREATE UNIQUE INDEX "device_identifier_value_held_uq"
  ON "device_identifier" ("value") WHERE "released_at" IS NULL;

-- Still needed for lookups against every identifier ever issued: a warranty
-- claim or a return searches by IMEI long after the unit was sold.
CREATE INDEX "device_identifier_value_idx" ON "device_identifier" ("value");

/*
 * The claim follows the device's status, maintained here rather than in the
 * service.
 *
 * Status moves through `setDeviceStatus`, but imports, scripts and fixes run
 * outside it. A claim that can be left stale by any of those is a claim that
 * eventually blocks a legitimate purchase, or worse, lets two live units share
 * a number.
 */
CREATE OR REPLACE FUNCTION device_identifier_follow_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IN ('SOLD', 'SOLD_PENDING_IMPORT', 'VOIDED', 'LOST') THEN
    -- Gone from the shop: give up the number.
    UPDATE "device_identifier"
    SET "released_at" = now()
    WHERE "device_id" = NEW."id" AND "released_at" IS NULL;
  ELSE
    /*
     * Back in hand - a sale returned, a lost handset found. Take the number
     * back only if nothing else holds it now. If the shop has since bought
     * another unit with the same IMEI, that one keeps the claim and this row
     * stays released: the returned device is still findable by its identifier,
     * it simply is not the one the number points at. Without this guard the
     * partial index would reject the return outright.
     */
    UPDATE "device_identifier" di
    SET "released_at" = NULL
    WHERE di."device_id" = NEW."id"
      AND di."released_at" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "device_identifier" other
        WHERE other."value" = di."value" AND other."released_at" IS NULL
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_identifier_follow_status_trg
AFTER UPDATE OF "status" ON "device_unit"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION device_identifier_follow_status();
