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
  ADD COLUMN IF NOT EXISTS "released_at" timestamp with time zone;

-- Existing rows: release the identifiers of anything not currently in hand.
-- Safe to run against the old global index - it guaranteed no duplicates, so
-- nothing here can collide.
--
-- `status::text`, not the enum, and this is NOT tidiable away. 'VOIDED' is
-- added to device_status by migration 0008, and the migrator runs every
-- pending migration in ONE transaction - so on a fresh database that value is
-- created and used in the same transaction, which Postgres refuses:
-- "unsafe use of new value VOIDED of enum type device_status". Comparing the
-- text form never consults pg_enum, so it does not care how new the label is.
UPDATE "device_identifier" di
SET "released_at" = now()
FROM "device_unit" du
WHERE du."id" = di."device_id"
  AND du."status"::text IN ('SOLD', 'SOLD_PENDING_IMPORT', 'VOIDED', 'LOST');

DROP INDEX IF EXISTS "device_identifier_value_uq";

-- The claim, enforced by the database rather than by application code alone.
-- Two concurrent purchases of the same IMEI cannot both win this.
CREATE UNIQUE INDEX IF NOT EXISTS "device_identifier_value_held_uq"
  ON "device_identifier" ("value") WHERE "released_at" IS NULL;

-- Still needed for lookups against every identifier ever issued: a warranty
-- claim or a return searches by IMEI long after the unit was sold.
CREATE INDEX IF NOT EXISTS "device_identifier_value_idx" ON "device_identifier" ("value");

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
  IF NEW."status"::text IN ('SOLD', 'SOLD_PENDING_IMPORT', 'VOIDED', 'LOST') THEN
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

DROP TRIGGER IF EXISTS device_identifier_follow_status_trg ON "device_unit";
CREATE TRIGGER device_identifier_follow_status_trg
AFTER UPDATE OF "status" ON "device_unit"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION device_identifier_follow_status();
