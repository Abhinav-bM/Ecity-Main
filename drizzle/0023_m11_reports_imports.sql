CREATE TYPE "public"."import_kind" AS ENUM('PRODUCTS', 'DEVICES', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'OPENING_CUSTOMER_DUES', 'OPENING_SUPPLIER_DUES');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('UPLOADED', 'VALIDATED', 'COMMITTED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "export_job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"report" text NOT NULL,
	"format" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"kind" "import_kind" NOT NULL,
	"status" "job_status" DEFAULT 'UPLOADED' NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"branch_id" bigint,
	"column_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"committed_rows" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" bigint,
	"committed_at" timestamp with time zone,
	"committed_by" bigint
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parsed" jsonb,
	"error" text,
	"applied_ref_type" text,
	"applied_ref_id" bigint
);
--> statement-breakpoint
CREATE TABLE "saved_report" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"report" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_job_id_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_job_business_idx" ON "export_job" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "import_job_business_idx" ON "import_job" USING btree ("business_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "import_job_hash_idx" ON "import_job" USING btree ("business_id","file_hash");--> statement-breakpoint
CREATE INDEX "import_row_job_idx" ON "import_row" USING btree ("job_id","row_number");--> statement-breakpoint
CREATE INDEX "import_row_error_idx" ON "import_row" USING btree ("job_id","error");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_report_owner_name_uq" ON "saved_report" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "saved_report_business_idx" ON "saved_report" USING btree ("business_id");