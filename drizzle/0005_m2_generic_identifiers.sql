-- Generalise a device's identifier so the same model covers phones, laptops,
-- MacBooks, speakers and anything else worth tracking individually.
--
-- The classification (NEW / USED / ER / ACT / GLOBAL, and NEW CUT inside
-- GLOBAL) is unchanged and applies to all of them. Only the *identifier*
-- differs: a phone has an IMEI, a laptop has a manufacturer serial.
--
-- HAND-WRITTEN. drizzle-kit generated ADD COLUMN "value" + DROP COLUMN "imei",
-- which would have discarded every existing identifier. These are renames.
-- See docs/05-Database-Guide.md §4.1.

CREATE TYPE "public"."identifier_type" AS ENUM('IMEI', 'SERIAL', 'NONE');--> statement-breakpoint

-- A category decides how its items are identified, which drives both the
-- database format check and the label the form shows.
ALTER TABLE "category" ADD COLUMN "identifier_type" "identifier_type" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
UPDATE "category" SET "identifier_type" = 'IMEI' WHERE "is_serialised" = true;--> statement-breakpoint

-- RENAME, never drop-and-add: these columns hold live identifiers.
ALTER TABLE "device_identifier" RENAME COLUMN "imei" TO "value";--> statement-breakpoint
ALTER TABLE "device_identifier" ADD COLUMN "type" "identifier_type" DEFAULT 'IMEI' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_unit" RENAME COLUMN "primary_imei" TO "primary_identifier";--> statement-breakpoint

-- Indexes follow the new column names.
DROP INDEX IF EXISTS "device_identifier_imei_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "device_unit_primary_imei_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "device_identifier_imei_trgm";--> statement-breakpoint
CREATE UNIQUE INDEX "device_identifier_value_uq" ON "device_identifier" USING btree ("value");--> statement-breakpoint
CREATE INDEX "device_unit_primary_identifier_idx" ON "device_unit" USING btree ("primary_identifier");--> statement-breakpoint
CREATE INDEX "device_identifier_value_trgm" ON "device_identifier" USING gin ("value" gin_trgm_ops);--> statement-breakpoint

-- The format check now depends on the kind of identifier.
--   IMEI   14-17 digits, as before.
--   SERIAL letters, digits and hyphens - e.g. a MacBook's C02XY1234ABC.
ALTER TABLE "device_identifier" DROP CONSTRAINT IF EXISTS "imei_digits";--> statement-breakpoint
ALTER TABLE "device_identifier" ADD CONSTRAINT "identifier_format" CHECK (
  ("type" = 'IMEI'   AND "value" ~ '^[0-9]{14,17}$') OR
  ("type" = 'SERIAL' AND "value" ~ '^[A-Za-z0-9][A-Za-z0-9/-]{3,49}$')
);
