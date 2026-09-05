-- A reversed purchase must not delete the units it created: device_event is
-- append-only, and docs/02 §2.2 rule 4 says inventory records move to a state
-- rather than disappearing. They become VOIDED instead.
--
-- Their identifiers ARE released, so a corrected purchase can reuse the same
-- IMEIs. The history stays; only the claim on the number is given up.
ALTER TYPE "public"."device_status" ADD VALUE IF NOT EXISTS 'VOIDED';
