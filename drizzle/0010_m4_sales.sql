CREATE TYPE "public"."sale_status" AS ENUM('COMPLETED', 'VOIDED');--> statement-breakpoint
-- Already added by 0008_m3_voided_device.sql. drizzle re-emits it because a
-- hand-written migration leaves its snapshot untouched; IF NOT EXISTS makes
-- replaying harmless.
ALTER TYPE "public"."device_status" ADD VALUE IF NOT EXISTS 'VOIDED';--> statement-breakpoint
CREATE TABLE "sale" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"customer_id" bigint,
	"invoice_number" text NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "sale_status" DEFAULT 'COMPLETED' NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"prices_included_tax" boolean DEFAULT true NOT NULL,
	"idempotency_key" text,
	"notes" text,
	"source" "record_source" DEFAULT 'ECITY' NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_by" bigint
);
--> statement-breakpoint
CREATE TABLE "sale_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sale_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"device_id" bigint,
	"description" text,
	"identifier_snapshot" text,
	"main_type_snapshot" "main_type",
	"is_new_cut_snapshot" boolean DEFAULT false NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_rate_id" bigint,
	"tax_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_payment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sale_id" bigint NOT NULL,
	"payment_method_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_invoice_number_uq" ON "sale" USING btree ("business_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_idempotency_uq" ON "sale" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sale_branch_date_idx" ON "sale" USING btree ("branch_id","sold_at");--> statement-breakpoint
CREATE INDEX "sale_customer_idx" ON "sale" USING btree ("customer_id","sold_at");--> statement-breakpoint
CREATE INDEX "sale_date_idx" ON "sale" USING btree ("business_id","sold_at");--> statement-breakpoint
CREATE INDEX "sale_item_sale_idx" ON "sale_item" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_item_product_idx" ON "sale_item" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_item_device_uq" ON "sale_item" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sale_payment_sale_idx" ON "sale_payment" USING btree ("sale_id");--> statement-breakpoint
-- M4 invariants, in the database rather than only in code.

ALTER TABLE "sale" ADD CONSTRAINT "sale_totals_non_negative" CHECK (
  "subtotal_paise" >= 0 AND "discount_paise" >= 0
  AND "taxable_paise" >= 0 AND "tax_paise" >= 0 AND "total_paise" >= 0
);--> statement-breakpoint

ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sane" CHECK (
  "quantity" > 0 AND "unit_price_paise" >= 0 AND "discount_paise" >= 0
  AND "tax_paise" >= 0 AND "tax_rate_basis_points" BETWEEN 0 AND 10000
);--> statement-breakpoint

-- A serialised line sells exactly one handset; a counted line sells no device.
ALTER TABLE "sale_item" ADD CONSTRAINT "device_line_is_one_unit" CHECK (
  "device_id" IS NULL OR "quantity" = 1
);--> statement-breakpoint

ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_positive"
  CHECK ("amount_paise" > 0);--> statement-breakpoint

-- NEW CUT is a designation inside GLOBAL on the invoice snapshot too.
ALTER TABLE "sale_item" ADD CONSTRAINT "snapshot_new_cut_only_global" CHECK (
  "is_new_cut_snapshot" = false OR "main_type_snapshot" = 'GLOBAL'
);
