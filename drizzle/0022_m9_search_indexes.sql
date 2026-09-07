-- M9 global search (PRD FR-30, §9.1: < 500 ms).
--
-- Every one of these backs an `ilike '%term%'` in search.service.ts. A leading
-- wildcard cannot use a btree index at all, so without these the search box
-- sequential-scans five tables on every keystroke. pg_trgm was created in 0001.

-- Customers: name, phone, alternate phone and email are all searchable
-- (FR-30.2), and phone is what the counter actually types.
CREATE INDEX IF NOT EXISTS "customer_name_trgm"
  ON "customer" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_phone_trgm"
  ON "customer" USING gin ("phone" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_alt_phone_trgm"
  ON "customer" USING gin ("alt_phone" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_email_trgm"
  ON "customer" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint

-- Suppliers: same fields, plus the company they trade as.
CREATE INDEX IF NOT EXISTS "supplier_name_trgm"
  ON "supplier" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_company_trgm"
  ON "supplier" USING gin ("company" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_phone_trgm"
  ON "supplier" USING gin ("phone" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_email_trgm"
  ON "supplier" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint

-- Products: name already has one from M2; SKU and barcode are searchable too.
CREATE INDEX IF NOT EXISTS "product_sku_trgm"
  ON "product" USING gin ("sku" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_barcode_trgm"
  ON "product" USING gin ("barcode" gin_trgm_ops);
--> statement-breakpoint

-- Documents by number.
CREATE INDEX IF NOT EXISTS "sale_invoice_number_trgm"
  ON "sale" USING gin ("invoice_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_number_trgm"
  ON "purchase" USING gin ("purchase_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_supplier_invoice_trgm"
  ON "purchase" USING gin ("supplier_invoice_number" gin_trgm_ops);
--> statement-breakpoint

-- The customer-visibility rule in search.service.ts asks "has this customer
-- bought at a branch I can see?" for every candidate row.
CREATE INDEX IF NOT EXISTS "sale_customer_branch_idx"
  ON "sale" ("customer_id", "branch_id");
