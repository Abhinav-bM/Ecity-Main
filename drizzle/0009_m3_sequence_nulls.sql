-- Gapless numbering was handing out duplicates.
--
-- Postgres treats NULLs as DISTINCT in a unique index by default, so with a
-- NULL branch_id (a business-wide series) ON CONFLICT never matched: every
-- call inserted a fresh counter row starting at 1, and two purchases could
-- take the same number.
--
-- NULLS NOT DISTINCT makes one NULL branch collide with another, which is what
-- "one series per business per kind" actually means. M4's invoice numbering
-- depends on this too.
DROP INDEX IF EXISTS "document_sequence_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequence_uq"
  ON "document_sequence" ("business_id", "kind", "branch_id") NULLS NOT DISTINCT;
