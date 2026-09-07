CREATE TYPE "public"."account_type" AS ENUM('BANK', 'UPI', 'CARD', 'WALLET', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."drawer_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."money_movement" AS ENUM('OPENING', 'SALE', 'CUSTOMER_PAYMENT', 'REFUND', 'EXPENSE', 'SUPPLIER_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "account" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"account_number" text,
	"bank_name" text,
	"ifsc" text,
	"upi_id" text,
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"reconciled_balance_paise" bigint,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_transaction" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"branch_id" bigint,
	"movement" "money_movement" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"business_date" date NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"transfer_group" text,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "cash_drawer_day" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"business_date" date NOT NULL,
	"opening_paise" bigint DEFAULT 0 NOT NULL,
	"status" "drawer_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"drawer_day_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"movement" "money_movement" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"note" text,
	"posted_after_close" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "daily_closing" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"business_date" date NOT NULL,
	"expected_cash_paise" bigint NOT NULL,
	"counted_cash_paise" bigint NOT NULL,
	"cash_difference_paise" bigint NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"external_feed_imported" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" bigint,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"payment_method_id" bigint NOT NULL,
	"account_id" bigint,
	"amount_paise" bigint NOT NULL,
	"business_date" date NOT NULL,
	"description" text,
	"reference" text,
	"posted_after_close" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_reconciled_by_app_user_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transaction" ADD CONSTRAINT "account_transaction_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transaction" ADD CONSTRAINT "account_transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transaction" ADD CONSTRAINT "account_transaction_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transaction" ADD CONSTRAINT "account_transaction_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_day" ADD CONSTRAINT "cash_drawer_day_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_day" ADD CONSTRAINT "cash_drawer_day_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_drawer_day_id_cash_drawer_day_id_fk" FOREIGN KEY ("drawer_day_id") REFERENCES "public"."cash_drawer_day"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closing" ADD CONSTRAINT "daily_closing_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closing" ADD CONSTRAINT "daily_closing_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closing" ADD CONSTRAINT "daily_closing_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closing" ADD CONSTRAINT "daily_closing_voided_by_app_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_voided_by_app_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_business_name_uq" ON "account" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "account_branch_idx" ON "account" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "account_txn_account_idx" ON "account_transaction" USING btree ("account_id","business_date");--> statement-breakpoint
CREATE INDEX "account_txn_business_idx" ON "account_transaction" USING btree ("business_id","business_date");--> statement-breakpoint
CREATE INDEX "account_txn_ref_idx" ON "account_transaction" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "account_txn_transfer_idx" ON "account_transaction" USING btree ("transfer_group");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_drawer_day_uq" ON "cash_drawer_day" USING btree ("branch_id","business_date");--> statement-breakpoint
CREATE INDEX "cash_drawer_day_business_idx" ON "cash_drawer_day" USING btree ("business_id","business_date");--> statement-breakpoint
CREATE INDEX "cash_movement_day_idx" ON "cash_movement" USING btree ("drawer_day_id");--> statement-breakpoint
CREATE INDEX "cash_movement_branch_idx" ON "cash_movement" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cash_movement_ref_idx" ON "cash_movement" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_closing_live_uq" ON "daily_closing" USING btree ("branch_id","business_date") WHERE voided_at is null;--> statement-breakpoint
CREATE INDEX "daily_closing_business_idx" ON "daily_closing" USING btree ("business_id","business_date");--> statement-breakpoint
CREATE INDEX "expense_branch_date_idx" ON "expense" USING btree ("branch_id","business_date");--> statement-breakpoint
CREATE INDEX "expense_business_date_idx" ON "expense" USING btree ("business_id","business_date");--> statement-breakpoint
CREATE INDEX "expense_category_idx" ON "expense" USING btree ("category_id");
--> statement-breakpoint
-- Both money ledgers are append-only. Expected cash and every account balance
-- are sums over these rows (docs/03 §4.2), so a reconciliation is only worth
-- anything if nothing can quietly rewrite what it is summing.
CREATE OR REPLACE FUNCTION cash_movement_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movement is append-only: % is not permitted', TG_OP
    USING HINT = 'Post a correcting movement; never rewrite one.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cash_movement_no_update ON cash_movement;
--> statement-breakpoint
CREATE TRIGGER cash_movement_no_update
  BEFORE UPDATE ON cash_movement
  FOR EACH ROW EXECUTE FUNCTION cash_movement_is_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS cash_movement_no_delete ON cash_movement;
--> statement-breakpoint
CREATE TRIGGER cash_movement_no_delete
  BEFORE DELETE ON cash_movement
  FOR EACH ROW EXECUTE FUNCTION cash_movement_is_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION account_transaction_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'account_transaction is append-only: % is not permitted', TG_OP
    USING HINT = 'Post a correcting transaction; never rewrite one.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS account_transaction_no_update ON account_transaction;
--> statement-breakpoint
CREATE TRIGGER account_transaction_no_update
  BEFORE UPDATE ON account_transaction
  FOR EACH ROW EXECUTE FUNCTION account_transaction_is_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS account_transaction_no_delete ON account_transaction;
--> statement-breakpoint
CREATE TRIGGER account_transaction_no_delete
  BEFORE DELETE ON account_transaction
  FOR EACH ROW EXECUTE FUNCTION account_transaction_is_append_only();
