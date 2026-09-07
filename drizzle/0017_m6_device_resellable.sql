DROP INDEX "sale_item_device_uq";--> statement-breakpoint
CREATE INDEX "sale_item_device_idx" ON "sale_item" USING btree ("device_id");