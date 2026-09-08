CREATE TYPE "public"."notification_kind" AS ENUM('LOW_STOCK', 'CUSTOMER_OVERDUE', 'SUPPLIER_DUE', 'CASH_MISMATCH', 'UNCLOSED_DAY', 'STOCK_ADJUSTMENT', 'WARRANTY_EXPIRY');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"branch_id" bigint,
	"kind" "notification_kind" NOT NULL,
	"severity" "notification_severity" DEFAULT 'WARNING' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"entity_type" text,
	"entity_id" bigint,
	"dedupe_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_read" (
	"notification_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_read_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notification_rule" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" bigint NOT NULL,
	"user_id" bigint,
	"kind" "notification_kind" NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"threshold_days" integer,
	"threshold_paise" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_unit" ADD COLUMN "warranty_provider" text;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_read" ADD CONSTRAINT "notification_read_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rule" ADD CONSTRAINT "notification_rule_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_business_idx" ON "notification" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_branch_idx" ON "notification" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "notification_dedupe_idx" ON "notification" USING btree ("business_id","dedupe_key","resolved_at");--> statement-breakpoint
CREATE INDEX "notification_read_user_idx" ON "notification_read" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_rule_shop_uq" ON "notification_rule" USING btree ("business_id","kind") WHERE "notification_rule"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_rule_user_uq" ON "notification_rule" USING btree ("business_id","user_id","kind") WHERE "notification_rule"."user_id" is not null;