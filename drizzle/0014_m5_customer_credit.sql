CREATE TYPE "public"."customer_ledger_entry_type" AS ENUM('OPENING', 'SALE', 'PAYMENT', 'REVERSAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "customer_ledger_entry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"branch_id" bigint,
	"entry_type" "customer_ledger_entry_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"note" text,
	"actor_id" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_payment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"payment_method_id" bigint NOT NULL,
	"receipt_number" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"received_on" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" text,
	"notes" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "customer_payment_allocation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" bigint NOT NULL,
	"sale_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "default_credit_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "credit_notes" text;--> statement-breakpoint
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocation" ADD CONSTRAINT "customer_payment_allocation_payment_id_customer_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocation" ADD CONSTRAINT "customer_payment_allocation_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_ledger_customer_idx" ON "customer_ledger_entry" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_ledger_ref_idx" ON "customer_ledger_entry" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "customer_ledger_branch_idx" ON "customer_ledger_entry" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_payment_customer_idx" ON "customer_payment" USING btree ("customer_id","received_on");--> statement-breakpoint
CREATE INDEX "customer_payment_branch_idx" ON "customer_payment" USING btree ("branch_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_payment_receipt_uq" ON "customer_payment" USING btree ("business_id","receipt_number");--> statement-breakpoint
CREATE INDEX "customer_allocation_payment_idx" ON "customer_payment_allocation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "customer_allocation_sale_idx" ON "customer_payment_allocation" USING btree ("sale_id");--> statement-breakpoint
-- The customer ledger is append-only (docs/03 §4.2). A balance derived from
-- rows that can be edited afterwards is not a ledger, it is a guess. Enforced
-- here rather than in code so no future path can bypass it.
CREATE OR REPLACE FUNCTION customer_ledger_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'customer_ledger_entry is append-only: % is not permitted', TG_OP
    USING HINT = 'Post a REVERSAL or ADJUSTMENT entry instead of changing history.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_ledger_no_update ON customer_ledger_entry;
--> statement-breakpoint
CREATE TRIGGER customer_ledger_no_update
  BEFORE UPDATE ON customer_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION customer_ledger_is_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_ledger_no_delete ON customer_ledger_entry;
--> statement-breakpoint
CREATE TRIGGER customer_ledger_no_delete
  BEFORE DELETE ON customer_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION customer_ledger_is_append_only();
