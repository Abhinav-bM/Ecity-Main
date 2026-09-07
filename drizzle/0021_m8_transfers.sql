CREATE TYPE "public"."adjustment_reason" AS ENUM('DAMAGE', 'LOSS', 'MISCOUNT', 'DATA_ENTRY_ERROR');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "stock_adjustment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"device_id" bigint,
	"reason" "adjustment_reason" NOT NULL,
	"quantity_delta" integer DEFAULT 0 NOT NULL,
	"quantity_before" integer,
	"quantity_after" integer,
	"device_status_before" "device_status",
	"device_status_after" "device_status",
	"main_type_snapshot" "main_type",
	"is_new_cut_snapshot" boolean DEFAULT false NOT NULL,
	"notes" text,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"transfer_number" text NOT NULL,
	"from_branch_id" bigint NOT NULL,
	"to_branch_id" bigint NOT NULL,
	"status" "transfer_status" DEFAULT 'REQUESTED' NOT NULL,
	"notes" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" bigint,
	"approved_at" timestamp with time zone,
	"approved_by" bigint,
	"dispatched_at" timestamp with time zone,
	"dispatched_by" bigint,
	"received_at" timestamp with time zone,
	"received_by" bigint,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" bigint,
	"cancel_reason" text,
	"has_discrepancy" boolean DEFAULT false NOT NULL,
	"discrepancy_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transfer_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"device_id" bigint,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_branch_id_branch_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_branch_id_branch_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_item" ADD CONSTRAINT "transfer_item_transfer_id_stock_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_item" ADD CONSTRAINT "transfer_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_item" ADD CONSTRAINT "transfer_item_device_id_device_unit_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustment_branch_idx" ON "stock_adjustment" USING btree ("branch_id","adjusted_at");--> statement-breakpoint
CREATE INDEX "stock_adjustment_business_idx" ON "stock_adjustment" USING btree ("business_id","adjusted_at");--> statement-breakpoint
CREATE INDEX "stock_adjustment_device_idx" ON "stock_adjustment" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_product_idx" ON "stock_adjustment" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfer_number_uq" ON "stock_transfer" USING btree ("business_id","transfer_number");--> statement-breakpoint
CREATE INDEX "stock_transfer_from_idx" ON "stock_transfer" USING btree ("from_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfer_to_idx" ON "stock_transfer" USING btree ("to_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfer_business_idx" ON "stock_transfer" USING btree ("business_id","requested_at");--> statement-breakpoint
CREATE INDEX "transfer_item_transfer_idx" ON "transfer_item" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfer_item_device_idx" ON "transfer_item" USING btree ("device_id");