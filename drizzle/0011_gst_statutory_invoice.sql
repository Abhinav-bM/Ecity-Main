ALTER TABLE "branch" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "hsn_code" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "cgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "sgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "igst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "place_of_supply_code" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "supply_state_code" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "is_inter_state" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "hsn_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "cgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "sgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "igst_paise" bigint DEFAULT 0 NOT NULL;