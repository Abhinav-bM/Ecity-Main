CREATE TYPE "public"."payment_status" AS ENUM('UNPAID', 'PARTIAL', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('DRAFT', 'CONFIRMED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."supplier_ledger_entry_type" AS ENUM('OPENING', 'PURCHASE', 'PAYMENT', 'REVERSAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "document_sequence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"branch_id" bigint,
	"prefix" text DEFAULT '' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"purchase_number" text NOT NULL,
	"supplier_invoice_number" text,
	"purchase_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "purchase_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"source" "record_source" DEFAULT 'ECITY' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "purchase_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_rate_id" bigint,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"is_serialised" boolean DEFAULT false NOT NULL,
	"main_type" "main_type",
	"is_new_cut" boolean DEFAULT false NOT NULL,
	"new_cut_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_ledger_entry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"branch_id" bigint,
	"entry_type" "supplier_ledger_entry_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"note" text,
	"actor_id" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"payment_method_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_on" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" text,
	"notes" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" bigint NOT NULL,
	"purchase_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "purchase_item_id" bigint;--> statement-breakpoint
ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entry" ADD CONSTRAINT "supplier_ledger_entry_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entry" ADD CONSTRAINT "supplier_ledger_entry_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_payment_id_supplier_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequence_uq" ON "document_sequence" USING btree ("business_id","kind","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_number_uq" ON "purchase" USING btree ("business_id","purchase_number");--> statement-breakpoint
CREATE INDEX "purchase_supplier_idx" ON "purchase" USING btree ("supplier_id","purchase_date");--> statement-breakpoint
CREATE INDEX "purchase_branch_idx" ON "purchase" USING btree ("branch_id","purchase_date");--> statement-breakpoint
CREATE INDEX "purchase_status_idx" ON "purchase" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "purchase_item_purchase_idx" ON "purchase_item" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_item_product_idx" ON "purchase_item" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "supplier_ledger_supplier_idx" ON "supplier_ledger_entry" USING btree ("supplier_id","occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_ledger_ref_idx" ON "supplier_ledger_entry" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_supplier_idx" ON "supplier_payment" USING btree ("supplier_id","paid_on");--> statement-breakpoint
CREATE INDEX "supplier_payment_branch_idx" ON "supplier_payment" USING btree ("branch_id","paid_on");--> statement-breakpoint
CREATE INDEX "supplier_allocation_payment_idx" ON "supplier_payment_allocation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "supplier_allocation_purchase_idx" ON "supplier_payment_allocation" USING btree ("purchase_id");--> statement-breakpoint
-- Invariants for M3, enforced in the database rather than only in code.

-- Money is never negative on a purchase or a payment.
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_totals_non_negative" CHECK (
  "subtotal_paise" >= 0 AND "discount_paise" >= 0
  AND "tax_paise" >= 0 AND "total_paise" >= 0
);--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_sane" CHECK (
  "quantity" > 0 AND "unit_cost_paise" >= 0
  AND "discount_paise" >= 0 AND "tax_paise" >= 0
);--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_positive"
  CHECK ("amount_paise" > 0);--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "allocation_positive"
  CHECK ("amount_paise" > 0);--> statement-breakpoint

-- A serialised line carries the classification onto every unit it creates,
-- so it must have one. A counted line must not.
ALTER TABLE "purchase_item" ADD CONSTRAINT "serialised_line_needs_main_type" CHECK (
  ("is_serialised" = false AND "main_type" IS NULL)
  OR ("is_serialised" = true AND "main_type" IS NOT NULL)
);--> statement-breakpoint

-- NEW CUT lives inside GLOBAL here too, exactly as on the device itself.
ALTER TABLE "purchase_item" ADD CONSTRAINT "line_new_cut_only_global"
  CHECK ("is_new_cut" = false OR "main_type" = 'GLOBAL');--> statement-breakpoint

-- The supplier ledger is append-only: a balance is only trustworthy if its
-- movements cannot be rewritten (same rule as device_event and stock_ledger).
DROP TRIGGER IF EXISTS supplier_ledger_no_update ON supplier_ledger_entry;--> statement-breakpoint
CREATE TRIGGER supplier_ledger_no_update
  BEFORE UPDATE ON supplier_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS supplier_ledger_no_delete ON supplier_ledger_entry;--> statement-breakpoint
CREATE TRIGGER supplier_ledger_no_delete
  BEFORE DELETE ON supplier_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION device_event_is_append_only();
