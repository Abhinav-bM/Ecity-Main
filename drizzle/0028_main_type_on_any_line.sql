-- Main type is no longer a serialised-only classification.
--
-- It was modelled as a handset property: the five types describe how a phone
-- was sourced, so a counted line was *forbidden* from carrying one. The shop
-- buys accessories in the same distinctions - a NEW batch of chargers is not
-- the same purchase as a job lot of used ones - and wants that recorded on
-- whatever it buys, not only on handsets.
--
-- The half of the rule that still matters is kept: a serialised line stamps
-- its classification onto every unit it creates, so it must still have one.
-- A counted line may now carry one, and may still leave it blank.
--
-- Note what this does NOT change. Accessories are a pooled quantity in
-- branch_stock, not individual rows, so ten NEW cables and five used ones are
-- still one stock figure of fifteen. The type is recorded against the
-- purchase, which is where the question "what did we buy, and of what kind?"
-- is actually asked.
ALTER TABLE "purchase_item" DROP CONSTRAINT IF EXISTS "serialised_line_needs_main_type";--> statement-breakpoint

ALTER TABLE "purchase_item" ADD CONSTRAINT "serialised_line_needs_main_type" CHECK (
  "is_serialised" = false OR "main_type" IS NOT NULL
);
