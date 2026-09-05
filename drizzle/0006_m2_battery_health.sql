ALTER TABLE "device_unit" ADD COLUMN "battery_health_percent" smallint;--> statement-breakpoint
ALTER TABLE "device_unit" ADD CONSTRAINT "battery_health_percent_range"
  CHECK ("battery_health_percent" IS NULL
     OR ("battery_health_percent" BETWEEN 1 AND 100));
