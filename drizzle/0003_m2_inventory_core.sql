CREATE TYPE "public"."device_event_type" AS ENUM('PURCHASED', 'RECEIVED', 'TRANSFERRED_OUT', 'TRANSFERRED_IN', 'RESERVED', 'SOLD', 'RETURNED', 'INSPECTED', 'RECLASSIFIED', 'REPAIRED', 'DAMAGED', 'LOST', 'ADJUSTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('IN_STOCK', 'RESERVED', 'SOLD', 'SOLD_PENDING_IMPORT', 'RETURNED', 'DAMAGED', 'LOST', 'REPAIR', 'IN_TRANSIT');--> statement-breakpoint
CREATE TYPE "public"."main_type" AS ENUM('NEW', 'USED', 'ER', 'ACT', 'GLOBAL');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('ECITY', 'LEGACY');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('ECITY', 'EXTERNAL', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."stock_movement" AS ENUM('OPENING', 'PURCHASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "branch_stock" (
	"product_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_stock_product_id_branch_id_pk" PRIMARY KEY("product_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_serialised" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "device_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"branch_id" bigint,
	"from_branch_id" bigint,
	"to_branch_id" bigint,
	"ref_type" text,
	"ref_id" bigint,
	"actor_id" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_identifier" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" bigint NOT NULL,
	"imei" text NOT NULL,
	"slot" smallint DEFAULT 1 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_unit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"primary_imei" text,
	"variant" text,
	"ram" text,
	"storage" text,
	"colour" text,
	"main_type" "main_type" NOT NULL,
	"is_new_cut" boolean DEFAULT false NOT NULL,
	"new_cut_notes" text,
	"purchase_price_paise" bigint,
	"selling_price_paise" bigint,
	"tax_rate_id" bigint,
	"supplier_id" bigint,
	"purchase_date" timestamp with time zone,
	"warranty_months" smallint,
	"warranty_expires_at" timestamp with time zone,
	"current_branch_id" bigint,
	"status" "device_status" DEFAULT 'IN_STOCK' NOT NULL,
	"sales_channel" "sales_channel" DEFAULT 'ECITY' NOT NULL,
	"source" "record_source" DEFAULT 'ECITY' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"category_id" bigint NOT NULL,
	"brand_id" bigint,
	"model" text,
	"sku" text,
	"barcode" text,
	"description" text,
	"image_url" text,
	"default_purchase_price_paise" bigint,
	"default_selling_price_paise" bigint,
	"tax_rate_id" bigint,
	"default_supplier_id" bigint,
	"is_serialised" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"movement" "stock_movement" NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"note" text,
	"actor_id" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "imei_slots" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_event" ADD CONSTRAINT "device_event_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_event" ADD CONSTRAINT "device_event_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_event" ADD CONSTRAINT "device_event_from_branch_id_branch_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_event" ADD CONSTRAINT "device_event_to_branch_id_branch_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_identifier" ADD CONSTRAINT "device_identifier_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "device_unit_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "device_unit_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "device_unit_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "device_unit_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "device_unit_current_branch_id_branch_id_fk" FOREIGN KEY ("current_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_default_supplier_id_supplier_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_stock_branch_idx" ON "branch_stock" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_business_name_uq" ON "brand" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "category_business_name_uq" ON "category" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "device_event_device_seq_uq" ON "device_event" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "device_event_device_idx" ON "device_event" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "device_event_type_idx" ON "device_event" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_identifier_imei_uq" ON "device_identifier" USING btree ("imei");--> statement-breakpoint
CREATE UNIQUE INDEX "device_identifier_device_slot_uq" ON "device_identifier" USING btree ("device_id","slot");--> statement-breakpoint
CREATE INDEX "device_identifier_device_idx" ON "device_identifier" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_unit_branch_status_idx" ON "device_unit" USING btree ("current_branch_id","status","main_type");--> statement-breakpoint
CREATE INDEX "device_unit_product_idx" ON "device_unit" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "device_unit_primary_imei_idx" ON "device_unit" USING btree ("primary_imei");--> statement-breakpoint
CREATE INDEX "device_unit_supplier_idx" ON "device_unit" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "device_unit_type_idx" ON "device_unit" USING btree ("business_id","main_type","is_new_cut");--> statement-breakpoint
CREATE INDEX "product_name_idx" ON "product" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("business_id","category_id");--> statement-breakpoint
CREATE INDEX "product_brand_idx" ON "product" USING btree ("business_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_sku_uq" ON "product" USING btree ("business_id","sku");--> statement-breakpoint
CREATE INDEX "product_barcode_idx" ON "product" USING btree ("business_id","barcode");--> statement-breakpoint
CREATE INDEX "stock_ledger_product_branch_idx" ON "stock_ledger" USING btree ("product_id","branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_ledger_branch_idx" ON "stock_ledger" USING btree ("branch_id","occurred_at");