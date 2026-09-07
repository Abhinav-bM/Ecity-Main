ALTER TABLE "business" ADD COLUMN "gst_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "gst_enabled" boolean DEFAULT true NOT NULL;