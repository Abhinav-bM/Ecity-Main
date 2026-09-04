/**
 * ECITY database schema - Modules M0 (Foundations) and M1 (Master Data).
 *
 * M0: business, users, roles, permissions, sessions, audit log.
 * M1: tax rates, payment methods, expense categories, customers, suppliers,
 *     attachments, and full branch management.
 * M2: categories, brands, products, per-branch stock, and the serialised
 *     device model - device_unit, device_identifier and the append-only
 *     device_event ledger that M9's IMEI history is read from.
 *
 * Conventions that apply to every table added from here on:
 *  - Money is ALWAYS bigint paise. Never numeric, never float. (docs/03 §4.1)
 *  - Nothing is hard-deleted; records carry a status. (docs/02 §2.2 rule 4)
 *  - Every table carries created/updated audit columns.
 */
import {
  bigserial,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/* ------------------------------------------------------------------ enums */

export const branchStatusEnum = pgEnum('branch_status', ['ACTIVE', 'INACTIVE'])

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'CASH',
  'UPI',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
])

export const partyStatusEnum = pgEnum('party_status', ['ACTIVE', 'INACTIVE'])

/**
 * The five main mobile types (PRD §5.1). Stored as codes; what ER and ACT
 * stand for is a display label in configuration, not a schema concern.
 * NEW CUT is NOT a sixth type - it is a designation inside GLOBAL.
 */
export const mainTypeEnum = pgEnum('main_type', ['NEW', 'USED', 'ER', 'ACT', 'GLOBAL'])

/** PRD §5.2 device status lifecycle. */
export const deviceStatusEnum = pgEnum('device_status', [
  'IN_STOCK',
  'RESERVED',
  'SOLD',
  'SOLD_PENDING_IMPORT',
  'RETURNED',
  'DAMAGED',
  'LOST',
  'REPAIR',
  'IN_TRANSIT',
])

/** Which system bills this device (PRD FR-38.1). NEW defaults to EXTERNAL. */
export const salesChannelEnum = pgEnum('sales_channel', ['ECITY', 'EXTERNAL', 'BOTH'])

/** Where a record came from (PRD FR-38.4). */
export const recordSourceEnum = pgEnum('record_source', ['ECITY', 'LEGACY'])

/** Everything that can happen to one device. Append-only (PRD FR-30.5). */
export const deviceEventTypeEnum = pgEnum('device_event_type', [
  'PURCHASED',
  'RECEIVED',
  'TRANSFERRED_OUT',
  'TRANSFERRED_IN',
  'RESERVED',
  'SOLD',
  'RETURNED',
  'INSPECTED',
  'RECLASSIFIED',
  'REPAIRED',
  'DAMAGED',
  'LOST',
  'ADJUSTED',
  'VOIDED',
])

/** Non-serialised stock movement, for the FR-21 movement report. */
export const stockMovementEnum = pgEnum('stock_movement', [
  'OPENING',
  'PURCHASE',
  'SALE',
  'RETURN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
])

export const auditActionEnum = pgEnum('audit_action', [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'SESSION_REVOKED',
  'PERMISSION_CHANGED',
])

/* --------------------------------------------------------------- business */

export const business = pgTable('business', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  logoUrl: text('logo_url'),
  email: text('email'),
  phone: text('phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  pincode: text('pincode'),
  gstin: text('gstin'),
  /** ISO 4217. Single currency per business (PRD OQ-8 assumed answered: single). */
  currency: text('currency').notNull().default('INR'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  /**
   * PRD FR-2.3. When true, the price typed on a bill already includes tax and
   * the tax component is derived from it; when false, tax is added on top.
   * This changes every total in the system, so it is a business-level setting
   * rather than a per-document choice.
   */
  pricesIncludeTax: boolean('prices_include_tax').notNull().default(true),
  /** PRD FR-2.2. Branch-level prefixes override this - see branch.invoicePrefix. */
  invoicePrefix: text('invoice_prefix').notNull().default('INV'),
  /**
   * PRD FR-4.11. How many IMEI inputs the purchase and product forms render.
   * It governs the UI and NOTHING else: the API, importer, search and reports
   * always handle a device's full identifier list. Raising it is a settings
   * change - no migration, no backfill, no release.
   */
  imeiSlots: smallint('imei_slots').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ----------------------------------------------------------------- branch */

export const branch = pgTable(
  'branch',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    /** Set in M1 once users exist; nullable by design. */
    managerUserId: bigint('manager_user_id', { mode: 'number' }).references(
      (): typeof appUser.id => appUser.id,
    ),
    email: text('email'),
    gstin: text('gstin'),
    /** PRD FR-26.3. Null means "use the business prefix". */
    invoicePrefix: text('invoice_prefix'),
    openedOn: timestamp('opened_on', { withTimezone: true }),
    notes: text('notes'),
    status: branchStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('branch_business_code_uq').on(t.businessId, t.code),
    index('branch_status_idx').on(t.businessId, t.status),
  ],
)

/* ------------------------------------------------------- roles/permissions */

/**
 * The permission catalogue. Rows are seeded from `src/lib/permissions.ts`
 * so that the code and the database can never drift.
 */
export const permission = pgTable('permission', {
  code: text('code').primaryKey(),
  group: text('group').notNull(),
  label: text('label').notNull(),
  description: text('description'),
})

export const role = pgTable(
  'role',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** System roles (ADMIN/MANAGER/STAFF) cannot be deleted, only edited. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('role_business_code_uq').on(t.businessId, t.code)],
)

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permission.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
)

/* ------------------------------------------------------------------ users */

export const appUser = pgTable(
  'app_user',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    /** Stored lower-cased; uniqueness is enforced on the lower-cased value. */
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    /** Default role. A branch assignment may override it (see userBranch). */
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => role.id),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: smallint('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('app_user_email_uq').on(t.businessId, t.email),
    index('app_user_active_idx').on(t.businessId, t.isActive),
  ],
)

/**
 * Which branches a user may act in, with an optional per-branch role override.
 * A NULL roleId means "use the user's default role in this branch".
 * PRD FR-1.3 / FR-3.2.
 */
export const userBranch = pgTable(
  'user_branch',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'number' }).references(() => role.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.branchId] }),
    index('user_branch_branch_idx').on(t.branchId),
  ],
)

/* --------------------------------------------------------------- sessions */

/**
 * Server-side sessions. The cookie carries a random token; only its SHA-256
 * hash is stored, so a database leak does not hand over live sessions.
 * Revocable (PRD FR-1.1) by setting revokedAt.
 */
export const session = pgTable(
  'session',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** The branch the user is currently working in; null means "all branches". */
    activeBranchId: bigint('active_branch_id', { mode: 'number' }).references(() => branch.id),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sliding idle expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Hard cap regardless of activity. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('session_token_hash_uq').on(t.tokenHash),
    index('session_user_idx').on(t.userId),
    index('session_expiry_idx').on(t.expiresAt),
  ],
)

export const passwordResetToken = pgTable(
  'password_reset_token',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_token_hash_uq').on(t.tokenHash),
    index('password_reset_user_idx').on(t.userId),
  ],
)

/* -------------------------------------------------------------- audit log */

/**
 * Append-only. The application role must not hold UPDATE or DELETE on this
 * table in production - see drizzle/0001_audit_append_only.sql.
 * PRD FR-1.4 / FR-31.1.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' }).notNull(),
    /** Null for system-generated actions (jobs, imports). */
    actorUserId: bigint('actor_user_id', { mode: 'number' }),
    actorLabel: text('actor_label'),
    action: auditActionEnum('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    branchId: bigint('branch_id', { mode: 'number' }),
    summary: text('summary'),
    /** { field: { from, to } } - only the fields that actually changed. */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_idx').on(t.actorUserId),
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_branch_idx').on(t.branchId),
  ],
)


/* =============================================================== M1 tables */

/**
 * Tax rates (PRD FR-2.3).
 * Rate is stored in BASIS POINTS as an integer - 18% is 1800. Never a float:
 * a tax rate multiplies money, and money is integer paise (docs/03 §4.1).
 */
export const taxRate = pgTable(
  'tax_rate',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    /** 1800 = 18.00%. Range 0 - 10000. */
    rateBasisPoints: integer('rate_basis_points').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tax_rate_business_name_uq').on(t.businessId, t.name),
    index('tax_rate_active_idx').on(t.businessId, t.isActive),
  ],
)

/** Payment methods (PRD FR-2.4). Cash/UPI/Card/Bank plus configurable others. */
export const paymentMethod = pgTable(
  'payment_method',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: paymentMethodTypeEnum('type').notNull(),
    /** Cash methods post to the branch cash drawer in M7; others to accounts. */
    affectsCashDrawer: boolean('affects_cash_drawer').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_method_business_code_uq').on(t.businessId, t.code)],
)

/** Expense categories (PRD FR-10.1). M7 posts expenses against these. */
export const expenseCategory = pgTable(
  'expense_category',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('expense_category_business_name_uq').on(t.businessId, t.name)],
)

/**
 * Customers (PRD FR-6.6). Business-wide, NOT per branch: FR-6.7 requires
 * spend and history to be visible across every branch.
 */
export const customer = pgTable(
  'customer',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    phone: text('phone'),
    altPhone: text('alt_phone'),
    email: text('email'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    gstin: text('gstin'),
    notes: text('notes'),
    status: partyStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    index('customer_name_idx').on(t.businessId, t.name),
    index('customer_phone_idx').on(t.businessId, t.phone),
    index('customer_email_idx').on(t.businessId, t.email),
  ],
)

/** Suppliers (PRD FR-5.10). Also business-wide - FR-14.3 shares them across branches. */
export const supplier = pgTable(
  'supplier',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'),
    altPhone: text('alt_phone'),
    email: text('email'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    gstin: text('gstin'),
    photoUrl: text('photo_url'),
    notes: text('notes'),
    status: partyStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    index('supplier_name_idx').on(t.businessId, t.name),
    index('supplier_phone_idx').on(t.businessId, t.phone),
    index('supplier_gstin_idx').on(t.businessId, t.gstin),
  ],
)

/**
 * Files attached to any record - supplier bills, expense receipts, product
 * images (PRD FR-5.13, FR-10.2). Only the storage key is held here; the file
 * itself lives in object storage and is served through a short-lived signed
 * URL, never a public bucket (docs/03 §5).
 */
export const attachment = pgTable(
  'attachment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    /** e.g. 'supplier', 'customer', 'expense', 'purchase'. */
    entityType: text('entity_type').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Opaque key in the storage driver. Never a URL - drivers change. */
    storageKey: text('storage_key').notNull(),
    uploadedBy: bigint('uploaded_by', { mode: 'number' }).references(() => appUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachment_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('attachment_storage_key_uq').on(t.storageKey),
  ],
)


/* =============================================================== M2 tables */

export const category = pgTable(
  'category',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    /**
     * Serialised categories hold mobiles: every unit is tracked individually
     * by IMEI. Non-serialised categories hold accessories, tracked by count.
     */
    isSerialised: boolean('is_serialised').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('category_business_name_uq').on(t.businessId, t.name)],
)

export const brand = pgTable(
  'brand',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('brand_business_name_uq').on(t.businessId, t.name)],
)

/**
 * The catalogue entry (PRD FR-4.2). For accessories this is the thing sold and
 * counted; for mobiles it is the *model*, and each physical handset is a
 * device_unit row pointing at it.
 *
 * Prices here are defaults for data entry. The price a device actually cost or
 * sold for lives on the device_unit or the sale line - never here.
 */
export const product = pgTable(
  'product',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => category.id),
    brandId: bigint('brand_id', { mode: 'number' }).references(() => brand.id),
    model: text('model'),
    sku: text('sku'),
    barcode: text('barcode'),
    description: text('description'),
    imageUrl: text('image_url'),
    /** Money is bigint paise, always (docs/03 §4.1). */
    defaultPurchasePricePaise: bigint('default_purchase_price_paise', { mode: 'bigint' }),
    defaultSellingPricePaise: bigint('default_selling_price_paise', { mode: 'bigint' }),
    taxRateId: bigint('tax_rate_id', { mode: 'number' }).references(() => taxRate.id),
    defaultSupplierId: bigint('default_supplier_id', { mode: 'number' }).references(
      () => supplier.id,
    ),
    /** Mirrors its category, denormalised so stock code need not join. */
    isSerialised: boolean('is_serialised').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    index('product_name_idx').on(t.businessId, t.name),
    index('product_category_idx').on(t.businessId, t.categoryId),
    index('product_brand_idx').on(t.businessId, t.brandId),
    uniqueIndex('product_sku_uq').on(t.businessId, t.sku),
    index('product_barcode_idx').on(t.businessId, t.barcode),
  ],
)

/**
 * Non-serialised stock: how many of a product a branch holds (PRD FR-4.6).
 * Stock is never business-wide - it always belongs to a branch.
 */
export const branchStock = pgTable(
  'branch_stock',
  {
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    quantity: integer('quantity').notNull().default(0),
    /** PRD FR-4.7. Drives the low-stock alerts in M13. */
    minQuantity: integer('min_quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.branchId] }),
    index('branch_stock_branch_idx').on(t.branchId),
  ],
)

/**
 * Append-only movement log for non-serialised stock. branch_stock.quantity is
 * the running total; this is how it got there, and it is what the FR-21
 * Opening -> Purchases -> Sales -> Returns -> Adjustments -> Current report
 * is built from.
 */
export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' }).notNull(),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    movement: stockMovementEnum('movement').notNull(),
    /** Signed: +5 received, -2 sold. */
    delta: integer('delta').notNull(),
    quantityAfter: integer('quantity_after').notNull(),
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    note: text('note'),
    actorId: bigint('actor_id', { mode: 'number' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_ledger_product_branch_idx').on(t.productId, t.branchId, t.occurredAt),
    index('stock_ledger_branch_idx').on(t.branchId, t.occurredAt),
  ],
)

/**
 * One physical handset (PRD §5.3). The atomic unit of mobile inventory.
 *
 * Its IMEIs live in device_identifier - a device may carry more than one, and
 * modelling them as columns would mean a migration the day a third appears
 * (docs/03 §4.4).
 */
export const deviceUnit = pgTable(
  'device_unit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),

    /** Cached from device_identifier for display and sorting only. */
    primaryImei: text('primary_imei'),

    variant: text('variant'),
    ram: text('ram'),
    storage: text('storage'),
    colour: text('colour'),

    /** PRD §5.1. is_new_cut is valid ONLY when mainType is GLOBAL. */
    mainType: mainTypeEnum('main_type').notNull(),
    isNewCut: boolean('is_new_cut').notNull().default(false),
    newCutNotes: text('new_cut_notes'),

    purchasePricePaise: bigint('purchase_price_paise', { mode: 'bigint' }),
    sellingPricePaise: bigint('selling_price_paise', { mode: 'bigint' }),
    taxRateId: bigint('tax_rate_id', { mode: 'number' }).references(() => taxRate.id),

    supplierId: bigint('supplier_id', { mode: 'number' }).references(() => supplier.id),
    purchaseDate: timestamp('purchase_date', { withTimezone: true }),
    warrantyMonths: smallint('warranty_months'),
    warrantyExpiresAt: timestamp('warranty_expires_at', { withTimezone: true }),

    currentBranchId: bigint('current_branch_id', { mode: 'number' }).references(() => branch.id),
    status: deviceStatusEnum('status').notNull().default('IN_STOCK'),

    /** PRD FR-38.1 / FR-38.4. Defaulted from mainType: NEW -> EXTERNAL. */
    salesChannel: salesChannelEnum('sales_channel').notNull().default('ECITY'),
    source: recordSourceEnum('source').notNull().default('ECITY'),

    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    index('device_unit_branch_status_idx').on(t.currentBranchId, t.status, t.mainType),
    index('device_unit_product_idx').on(t.productId),
    index('device_unit_primary_imei_idx').on(t.primaryImei),
    index('device_unit_supplier_idx').on(t.supplierId),
    index('device_unit_type_idx').on(t.businessId, t.mainType, t.isNewCut),
  ],
)

/**
 * A device's IMEIs (PRD FR-4.8 - FR-4.12). One row per identifier, so a third
 * one costs nothing. Unique across the whole business.
 */
export const deviceIdentifier = pgTable(
  'device_identifier',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: bigint('device_id', { mode: 'number' })
      .notNull()
      .references(() => deviceUnit.id, { onDelete: 'restrict' }),
    imei: text('imei').notNull(),
    /** 1 = first SIM slot. */
    slot: smallint('slot').notNull().default(1),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('device_identifier_imei_uq').on(t.imei),
    uniqueIndex('device_identifier_device_slot_uq').on(t.deviceId, t.slot),
    index('device_identifier_device_idx').on(t.deviceId),
  ],
)

/**
 * Append-only lifecycle log for one device. This single table is what makes
 * PRD FR-30 possible: the IMEI history page is one indexed read of it, joined
 * out to the documents it references.
 *
 * UPDATE and DELETE are refused by a trigger - see the migration.
 */
export const deviceEvent = pgTable(
  'device_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: bigint('device_id', { mode: 'number' })
      .notNull()
      .references(() => deviceUnit.id, { onDelete: 'restrict' }),
    /** Ordering within a device. Unique per device. */
    seq: integer('seq').notNull(),
    eventType: deviceEventTypeEnum('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    fromBranchId: bigint('from_branch_id', { mode: 'number' }).references(() => branch.id),
    toBranchId: bigint('to_branch_id', { mode: 'number' }).references(() => branch.id),
    /** purchase | sale | transfer | return | adjustment | import */
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    actorId: bigint('actor_id', { mode: 'number' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('device_event_device_seq_uq').on(t.deviceId, t.seq),
    index('device_event_device_idx').on(t.deviceId, t.seq),
    index('device_event_type_idx').on(t.eventType, t.occurredAt),
  ],
)

export type Category = typeof category.$inferSelect
export type Brand = typeof brand.$inferSelect
export type Product = typeof product.$inferSelect
export type BranchStock = typeof branchStock.$inferSelect
export type StockLedger = typeof stockLedger.$inferSelect
export type DeviceUnit = typeof deviceUnit.$inferSelect
export type DeviceIdentifier = typeof deviceIdentifier.$inferSelect
export type DeviceEvent = typeof deviceEvent.$inferSelect
export type MainType = (typeof mainTypeEnum.enumValues)[number]
export type DeviceStatus = (typeof deviceStatusEnum.enumValues)[number]

export type TaxRate = typeof taxRate.$inferSelect
export type PaymentMethod = typeof paymentMethod.$inferSelect
export type ExpenseCategory = typeof expenseCategory.$inferSelect
export type Customer = typeof customer.$inferSelect
export type Supplier = typeof supplier.$inferSelect
export type Attachment = typeof attachment.$inferSelect

export type Business = typeof business.$inferSelect
export type Branch = typeof branch.$inferSelect
export type Role = typeof role.$inferSelect
export type AppUser = typeof appUser.$inferSelect
export type Session = typeof session.$inferSelect
export type AuditLog = typeof auditLog.$inferSelect
