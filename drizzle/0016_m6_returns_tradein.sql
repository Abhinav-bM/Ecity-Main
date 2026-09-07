CREATE TYPE "public"."inspection_grade" AS ENUM('AVAILABLE', 'USED', 'DAMAGED', 'REPAIR_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('PAYMENT_METHOD', 'CUSTOMER_ACCOUNT');--> statement-breakpoint
CREATE TYPE "public"."return_type" AS ENUM('FULL', 'PARTIAL', 'EXCHANGE');--> statement-breakpoint
CREATE TABLE "refund" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"return_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"method" "refund_method" NOT NULL,
	"payment_method_id" bigint,
	"amount_paise" bigint NOT NULL,
	"reference" text,
	"refunded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "return_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"return_id" bigint NOT NULL,
	"sale_item_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"device_id" bigint,
	"description" text,
	"identifier_snapshot" text,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_return" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"sale_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"customer_id" bigint,
	"return_number" text NOT NULL,
	"return_type" "return_type" NOT NULL,
	"returned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"deduction_paise" bigint DEFAULT 0 NOT NULL,
	"refunded_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "trade_in" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"sale_id" bigint,
	"device_id" bigint,
	"customer_id" bigint,
	"branch_id" bigint NOT NULL,
	"estimated_value_paise" bigint,
	"agreed_value_paise" bigint NOT NULL,
	"condition_notes" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "inspection_grade" "inspection_grade";--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "inspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "inspected_by" bigint;--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "inspection_notes" text;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_return_id_sales_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_item" ADD CONSTRAINT "return_item_return_id_sales_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_item" ADD CONSTRAINT "return_item_sale_item_id_sale_item_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_item" ADD CONSTRAINT "return_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_item" ADD CONSTRAINT "return_item_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in" ADD CONSTRAINT "trade_in_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in" ADD CONSTRAINT "trade_in_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in" ADD CONSTRAINT "trade_in_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in" ADD CONSTRAINT "trade_in_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in" ADD CONSTRAINT "trade_in_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_return_idx" ON "refund" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "refund_branch_idx" ON "refund" USING btree ("branch_id","refunded_at");--> statement-breakpoint
CREATE INDEX "return_item_return_idx" ON "return_item" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_item_sale_item_idx" ON "return_item" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX "return_item_device_idx" ON "return_item" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sales_return_sale_idx" ON "sales_return" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_return_customer_idx" ON "sales_return" USING btree ("customer_id","returned_at");--> statement-breakpoint
CREATE INDEX "sales_return_branch_idx" ON "sales_return" USING btree ("branch_id","returned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_return_number_uq" ON "sales_return" USING btree ("business_id","return_number");--> statement-breakpoint
CREATE INDEX "trade_in_sale_idx" ON "trade_in" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "trade_in_customer_idx" ON "trade_in" USING btree ("customer_id","accepted_at");--> statement-breakpoint
CREATE INDEX "trade_in_branch_idx" ON "trade_in" USING btree ("branch_id","accepted_at");