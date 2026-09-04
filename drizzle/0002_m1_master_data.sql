CREATE TYPE "public"."party_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"alt_phone" text,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"gstin" text,
	"notes" text,
	"status" "party_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "expense_category" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"affects_cash_drawer" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"alt_phone" text,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"gstin" text,
	"photo_url" text,
	"notes" text,
	"status" "party_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "tax_rate" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"name" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "opened_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "updated_by" bigint;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "invoice_prefix" text DEFAULT 'INV' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_entity_idx" ON "attachment" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_storage_key_uq" ON "attachment" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "customer_name_idx" ON "customer" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "customer_phone_idx" ON "customer" USING btree ("business_id","phone");--> statement-breakpoint
CREATE INDEX "customer_email_idx" ON "customer" USING btree ("business_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_business_name_uq" ON "expense_category" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_business_code_uq" ON "payment_method" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "supplier_name_idx" ON "supplier" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "supplier_phone_idx" ON "supplier" USING btree ("business_id","phone");--> statement-breakpoint
CREATE INDEX "supplier_gstin_idx" ON "supplier" USING btree ("business_id","gstin");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_business_name_uq" ON "tax_rate" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "tax_rate_active_idx" ON "tax_rate" USING btree ("business_id","is_active");--> statement-breakpoint
CREATE INDEX "branch_status_idx" ON "branch" USING btree ("business_id","status");