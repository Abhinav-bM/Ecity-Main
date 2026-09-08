/**
 * ECITY database schema - Modules M0 (Foundations) and M1 (Master Data).
 *
 * M0: business, users, roles, permissions, sessions, audit log.
 * M1: tax rates, payment methods, expense categories, customers, suppliers,
 *     attachments, and full branch management.
 * M2: categories, brands, products, per-branch stock, and the serialised
 *     device model - device_unit, device_identifier and the append-only
 *     device_event ledger that M9's IMEI history is read from.
 * M3: purchases and their lines, the append-only supplier ledger, supplier
 *     payments and their allocations, and gapless document numbering.
 * M4: sales, their lines and payments. Selling is what takes stock out.
 *
 * Conventions that apply to every table added from here on:
 *  - Money is ALWAYS bigint paise. Never numeric, never float. (docs/03 §4.1)
 *  - Nothing is hard-deleted; records carry a status. (docs/02 §2.2 rule 4)
 *  - Every table carries created/updated audit columns.
 */
import { sql } from 'drizzle-orm'
import {
  bigserial,
  bigint,
  boolean,
  date,
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
  /** Its purchase was reversed. Kept for history; never sellable. */
  'VOIDED',
])

/**
 * How a serialised item is identified. Phones carry an IMEI; laptops,
 * MacBooks and other electronics carry a manufacturer serial number. The
 * classification (NEW/USED/ER/ACT/GLOBAL) is the same either way - only the
 * identifier differs.
 */
export const identifierTypeEnum = pgEnum('identifier_type', ['IMEI', 'SERIAL', 'NONE'])

export const saleStatusEnum = pgEnum('sale_status', ['COMPLETED', 'VOIDED'])

export const purchaseStatusEnum = pgEnum('purchase_status', [
  'DRAFT',
  'CONFIRMED',
  'REVERSED',
])

/** PRD FR-5.12. Derived from what has been allocated against the purchase. */
export const paymentStatusEnum = pgEnum('payment_status', ['UNPAID', 'PARTIAL', 'PAID'])

/** Append-only supplier ledger. Positive increases what the shop owes. */
export const supplierLedgerEnum = pgEnum('supplier_ledger_entry_type', [
  'OPENING',
  'PURCHASE',
  'PAYMENT',
  'REVERSAL',
  'ADJUSTMENT',
])

/**
 * PRD FR-8.3. The condition a returned device is graded at on inspection.
 *
 * Deliberately NOT the same field as main type. FR-8.4 requires main type and
 * GLOBAL/NEW CUT to survive a return unchanged, so a returned GLOBAL handset
 * graded "used" must still read GLOBAL afterwards. Condition and
 * classification are different facts about the same device; changing the main
 * type is a separate, deliberate edit.
 */
export const inspectionGradeEnum = pgEnum('inspection_grade', [
  'AVAILABLE',
  'USED',
  'DAMAGED',
  'REPAIR_REQUIRED',
])

/** PRD FR-8.1. What kind of return this is. */
export const returnTypeEnum = pgEnum('return_type', ['FULL', 'PARTIAL', 'EXCHANGE'])

/** Where the money for a return went. */
export const refundMethodEnum = pgEnum('refund_method', ['PAYMENT_METHOD', 'CUSTOMER_ACCOUNT'])

/**
 * Customer ledger movements (PRD FR-7.4). Positive means the customer owes
 * more; negative means they owe less.
 */
export const customerLedgerEnum = pgEnum('customer_ledger_entry_type', [
  'OPENING',
  'SALE',
  'PAYMENT',
  'REVERSAL',
  'ADJUSTMENT',
])

/** Which system bills this device (PRD FR-38.1). NEW defaults to EXTERNAL. */
export const salesChannelEnum = pgEnum('sales_channel', ['ECITY', 'EXTERNAL', 'BOTH'])

/** M7. What kind of account holds money outside the till (PRD FR-12.1). */
export const accountTypeEnum = pgEnum('account_type', ['BANK', 'UPI', 'CARD', 'WALLET', 'OTHER'])

/** M7. Why money moved through the drawer or an account (PRD FR-11.2, FR-12.3). */
export const moneyMovementEnum = pgEnum('money_movement', [
  'OPENING',
  'SALE',
  'CUSTOMER_PAYMENT',
  'REFUND',
  'EXPENSE',
  'SUPPLIER_PAYMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
])

/** M7. A drawer day is open until it is counted and signed off (PRD FR-11.1). */
export const drawerStatusEnum = pgEnum('drawer_status', ['OPEN', 'CLOSED'])

/**
 * M8. The transfer lifecycle (PRD FR-3.6).
 *
 * Enforced server-side by a transition table, like the device lifecycle - the
 * states exist so stock cannot be in two branches at once, or in none.
 */
export const transferStatusEnum = pgEnum('transfer_status', [
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
])

/** M11. Where an import or export got to (PRD FR-33, FR-34). */
export const jobStatusEnum = pgEnum('job_status', [
  'UPLOADED',
  'VALIDATED',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
])

/** M11. What a file is bringing in (PRD FR-34.1). */
export const importKindEnum = pgEnum('import_kind', [
  'PRODUCTS',
  'DEVICES',
  'CUSTOMERS',
  'SUPPLIERS',
  'OPENING_STOCK',
  'OPENING_CUSTOMER_DUES',
  'OPENING_SUPPLIER_DUES',
])

/** M8. Why stock was corrected (PRD FR-28.3). */
export const adjustmentReasonEnum = pgEnum('adjustment_reason', [
  'DAMAGE',
  'LOSS',
  'MISCOUNT',
  'DATA_ENTRY_ERROR',
])

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
  /** Two-digit GST state code; the first two digits of the GSTIN. */
  stateCode: text('state_code'),
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
  /**
   * Is the shop registered for GST?
   *
   * A used-phone dealer trading below the threshold is not, and must not issue
   * a tax invoice or show a GSTIN. When this is off the server forces every
   * line to 0% and the GST fields disappear from the app; turning it back on
   * later is this one switch, because nothing is deleted.
   *
   * What a past bill was issued under is stamped on the sale itself
   * (`sale.gst_enabled`), never read back from here - see that column.
   */
  gstEnabled: boolean('gst_enabled').notNull().default(true),
  /**
   * PRD FR-38.1 / OQ-11. Which system bills NEW stock.
   *
   * EXTERNAL, and deliberately so. The shop runs two separate businesses: NEW
   * handsets are bought, stocked and billed entirely in the other system, and
   * ECITY handles everything else - used, ER, ACT and GLOBAL. They do not
   * overlap (docs/02 §2.3).
   *
   * So this is not a stopgap waiting for an importer. It is the line between
   * the two businesses, and the till's refusal to sell an EXTERNAL device is
   * what keeps them from crossing. A shop that wants to bill NEW here as well
   * sets this to ECITY. Anything that is not NEW is always ECITY.
   */
  newStockSalesChannel: salesChannelEnum('new_stock_sales_channel')
    .notNull()
    .default('EXTERNAL'),
  /**
   * PRD FR-7.2. How many days a credit sale gets by default. The counter can
   * always override it on the bill.
   */
  defaultCreditDays: integer('default_credit_days').notNull().default(30),
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
    /** Two-digit GST state code. A branch in another state bills inter-state. */
    stateCode: text('state_code'),
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
    /** Two-digit GST state code; governs place of supply on their invoices. */
    stateCode: text('state_code'),
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
    /** Two-digit GST state code; needed for input credit on purchases. */
    stateCode: text('state_code'),
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
     * Serialised categories track every unit individually - phones, laptops,
     * and any other item worth following by its own identifier.
     * Non-serialised categories are counted per branch.
     */
    isSerialised: boolean('is_serialised').notNull().default(false),
    /**
     * What that identifier looks like. Drives both the database format check
     * and the label the form shows ("IMEI" vs "Serial number").
     */
    identifierType: identifierTypeEnum('identifier_type').notNull().default('NONE'),
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
    /** HSN (goods) or SAC (services). Printed on every statutory invoice. */
    hsnCode: text('hsn_code'),
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

    /**
     * Cached from device_identifier for display and sorting only - never the
     * source of truth. Holds an IMEI for a phone, a serial for a laptop.
     */
    primaryIdentifier: text('primary_identifier'),

    variant: text('variant'),
    ram: text('ram'),
    storage: text('storage'),
    colour: text('colour'),
    /**
     * Battery health as a whole percentage, 1-100. Nullable: a sealed NEW
     * device has no meaningful reading, and a laptop or speaker may have none
     * either. It matters most for USED and trade-in stock, where it drives
     * the price.
     */
    batteryHealthPercent: smallint('battery_health_percent'),

    /**
     * PRD FR-8.3. Set when a returned device is inspected. Independent of
     * main type: a GLOBAL handset graded USED is still GLOBAL.
     */
    inspectionGrade: inspectionGradeEnum('inspection_grade'),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    inspectedBy: bigint('inspected_by', { mode: 'number' }),
    inspectionNotes: text('inspection_notes'),

    /** PRD §5.1. is_new_cut is valid ONLY when mainType is GLOBAL. */
    mainType: mainTypeEnum('main_type').notNull(),
    isNewCut: boolean('is_new_cut').notNull().default(false),
    newCutNotes: text('new_cut_notes'),

    purchasePricePaise: bigint('purchase_price_paise', { mode: 'bigint' }),
    sellingPricePaise: bigint('selling_price_paise', { mode: 'bigint' }),
    taxRateId: bigint('tax_rate_id', { mode: 'number' }).references(() => taxRate.id),

    supplierId: bigint('supplier_id', { mode: 'number' }).references(() => supplier.id),
    /**
     * The purchase line that brought this unit in, when it came through a
     * purchase rather than opening stock. Reversal uses it to find every unit
     * a purchase created, and M9 uses it to link the history back to the bill.
     */
    purchaseItemId: bigint('purchase_item_id', { mode: 'number' }),
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
    index('device_unit_primary_identifier_idx').on(t.primaryIdentifier),
    index('device_unit_supplier_idx').on(t.supplierId),
    index('device_unit_type_idx').on(t.businessId, t.mainType, t.isNewCut),
  ],
)

/**
 * A device's identifiers (PRD FR-4.8 - FR-4.12). One row each, so a second or
 * third costs nothing. Unique across the whole business.
 *
 * A phone carries one IMEI per SIM slot; a laptop or speaker carries a single
 * manufacturer serial. The column is `value`, not `imei`, because a column
 * named `imei` holding "C02XY1234ABC" would mislead everyone who reads it.
 */
export const deviceIdentifier = pgTable(
  'device_identifier',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: bigint('device_id', { mode: 'number' })
      .notNull()
      .references(() => deviceUnit.id, { onDelete: 'restrict' }),
    value: text('value').notNull(),
    type: identifierTypeEnum('type').notNull().default('IMEI'),
    /** 1 = first SIM slot, or simply the first identifier. */
    slot: smallint('slot').notNull().default(1),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('device_identifier_value_uq').on(t.value),
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


/* =============================================================== M3 tables */

/**
 * Gapless per-business document numbering (PRD FR-2.2, FR-26.3).
 *
 * A counter row locked with SELECT ... FOR UPDATE, so two people confirming a
 * purchase at the same moment cannot take the same number. M4 reuses this for
 * invoices, with `kind` and an optional branch scope.
 */
export const documentSequence = pgTable(
  'document_sequence',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    /** 'purchase' | 'invoice' | ... */
    kind: text('kind').notNull(),
    /** Null for a business-wide series; set for a per-branch one. */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    prefix: text('prefix').notNull().default(''),
    nextNumber: integer('next_number').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * The real index carries NULLS NOT DISTINCT - see
     * drizzle/0009_m3_sequence_nulls.sql. A business-wide series has a NULL
     * branch, and two NULLs must collide for ON CONFLICT to find the existing
     * counter; without it every call inserted a fresh counter at 1 and two
     * purchases could take the same number.
     *
     * drizzle-kit's builder cannot express NULLS NOT DISTINCT in this version,
     * so if a future `db:generate` proposes dropping and recreating this
     * index, keep the migration's definition.
     */
    uniqueIndex('document_sequence_uq').on(t.businessId, t.kind, t.branchId),
  ],
)

/**
 * A purchase from a supplier (PRD FR-5.8). Confirming it is what actually
 * moves stock; a draft moves nothing.
 */
export const purchase = pgTable(
  'purchase',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    supplierId: bigint('supplier_id', { mode: 'number' })
      .notNull()
      .references(() => supplier.id),
    purchaseNumber: text('purchase_number').notNull(),
    /** The supplier's own bill number, when they gave one. */
    supplierInvoiceNumber: text('supplier_invoice_number'),
    purchaseDate: timestamp('purchase_date', { withTimezone: true }).notNull().defaultNow(),
    status: purchaseStatusEnum('status').notNull().default('DRAFT'),

    /** Money is bigint paise throughout (docs/03 §4.1). */
    subtotalPaise: bigint('subtotal_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    discountPaise: bigint('discount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    notes: text('notes'),
    source: recordSourceEnum('source').notNull().default('ECITY'),

    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversalReason: text('reversal_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('purchase_number_uq').on(t.businessId, t.purchaseNumber),
    index('purchase_supplier_idx').on(t.supplierId, t.purchaseDate),
    index('purchase_branch_idx').on(t.branchId, t.purchaseDate),
    index('purchase_status_idx').on(t.businessId, t.status),
  ],
)

export const purchaseItem = pgTable(
  'purchase_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => purchase.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    /**
     * For a serialised line this must equal the number of identifiers
     * supplied - five IMEIs means five handsets, never four.
     */
    quantity: integer('quantity').notNull(),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'bigint' }).notNull(),
    discountPaise: bigint('discount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxRateId: bigint('tax_rate_id', { mode: 'number' }).references(() => taxRate.id),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    lineTotalPaise: bigint('line_total_paise', { mode: 'bigint' }).notNull(),
    /** Denormalised from the product so reversal need not join. */
    isSerialised: boolean('is_serialised').notNull().default(false),
    /** Serialised lines carry these onto every unit they create. */
    mainType: mainTypeEnum('main_type'),
    isNewCut: boolean('is_new_cut').notNull().default(false),
    newCutNotes: text('new_cut_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('purchase_item_purchase_idx').on(t.purchaseId),
    index('purchase_item_product_idx').on(t.productId),
  ],
)

/**
 * What the shop owes each supplier (PRD FR-14.1). Append-only: the balance is
 * always the sum of these rows, never a stored number that can drift.
 * Positive increases the debt, negative reduces it.
 */
export const supplierLedgerEntry = pgTable(
  'supplier_ledger_entry',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' }).notNull(),
    supplierId: bigint('supplier_id', { mode: 'number' })
      .notNull()
      .references(() => supplier.id),
    /** Where it happened. Suppliers are shared, but the money is a branch's. */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    entryType: supplierLedgerEnum('entry_type').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    note: text('note'),
    actorId: bigint('actor_id', { mode: 'number' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplier_ledger_supplier_idx').on(t.supplierId, t.occurredAt),
    index('supplier_ledger_ref_idx').on(t.refType, t.refId),
  ],
)

/** A payment made to a supplier (PRD FR-14.2). */
export const supplierPayment = pgTable(
  'supplier_payment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    supplierId: bigint('supplier_id', { mode: 'number' })
      .notNull()
      .references(() => supplier.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    paymentMethodId: bigint('payment_method_id', { mode: 'number' })
      .notNull()
      .references(() => paymentMethod.id),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    paidOn: timestamp('paid_on', { withTimezone: true }).notNull().defaultNow(),
    reference: text('reference'),
    notes: text('notes'),
    /** Voided rather than deleted (docs/02 §2.2 rule 4). */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('supplier_payment_supplier_idx').on(t.supplierId, t.paidOn),
    index('supplier_payment_branch_idx').on(t.branchId, t.paidOn),
  ],
)

/**
 * Which purchases a payment settled. Without this a supplier balance is known
 * but no individual purchase could report Paid / Partial / Unpaid (FR-5.12).
 */
export const supplierPaymentAllocation = pgTable(
  'supplier_payment_allocation',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => supplierPayment.id, { onDelete: 'cascade' }),
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => purchase.id),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplier_allocation_payment_idx').on(t.paymentId),
    index('supplier_allocation_purchase_idx').on(t.purchaseId),
  ],
)


/* =============================================================== M4 tables */

/**
 * A sale (PRD FR-6.1 - FR-6.8). Completing one takes stock out, marks devices
 * SOLD, posts payments and numbers the invoice - all in one transaction.
 */
export const sale = pgTable(
  'sale',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    /** Null for a walk-in paying cash - most accessory sales need no record. */
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    invoiceNumber: text('invoice_number').notNull(),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    status: saleStatusEnum('status').notNull().default('COMPLETED'),

    subtotalPaise: bigint('subtotal_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    discountPaise: bigint('discount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxablePaise: bigint('taxable_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    /**
     * The statutory split (PRD OQ-4, resolved: compliant invoices required).
     * Intra-state supply splits the tax into CGST + SGST; inter-state puts it
     * all in IGST. Stored rather than derived because an invoice is a legal
     * document and must reprint identically years later, even if the branch
     * or the customer later moves state.
     */
    cgstPaise: bigint('cgst_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    sgstPaise: bigint('sgst_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    igstPaise: bigint('igst_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    /** GST state code the supply is taxed in, snapshotted at sale time. */
    placeOfSupplyCode: text('place_of_supply_code'),
    /** The branch's own state code at sale time. */
    supplyStateCode: text('supply_state_code'),
    isInterState: boolean('is_inter_state').notNull().default(false),

    /**
     * Whether prices on this bill were tax-inclusive, captured at the time.
     * The business setting can change later; a reprinted invoice must still
     * show the arithmetic that was used.
     */
    pricesIncludedTax: boolean('prices_included_tax').notNull().default(true),

    /**
     * Was the shop registered for GST when this bill was issued?
     *
     * Stamped here rather than read from the business setting, for the same
     * reason as the line above: nothing archives the PDF, so every reprint is
     * a fresh render. Without this, registering for GST next year would make
     * every bill issued before it reprint as a tax invoice, headed with a
     * GSTIN the shop did not have at the time.
     *
     * Zero tax cannot stand in for it: exempt and zero-rated goods sold under
     * GST are also zero, and those DO belong on a tax invoice with an HSN.
     * Defaults true, so every bill issued so far stays what it was.
     */
    gstEnabled: boolean('gst_enabled').notNull().default(true),

    /**
     * Generated by the browser before submitting (PRD NFR §9.3). A retry after
     * a dropped connection returns the original sale rather than billing the
     * customer twice.
     */
    idempotencyKey: text('idempotency_key'),

    notes: text('notes'),

    /**
     * PRD FR-7.2. Set when a bill leaves the counter unpaid. Outstanding is
     * NOT stored - it is always derived from the ledger (docs/03 §4.2) - but
     * the date the shop expects the money is a fact about the sale.
     */
    dueDate: timestamp('due_date', { withTimezone: true }),
    creditNotes: text('credit_notes'),

    source: recordSourceEnum('source').notNull().default('ECITY'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    soldBy: bigint('sold_by', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('sale_invoice_number_uq').on(t.businessId, t.invoiceNumber),
    uniqueIndex('sale_idempotency_uq').on(t.businessId, t.idempotencyKey),
    index('sale_branch_date_idx').on(t.branchId, t.soldAt),
    index('sale_customer_idx').on(t.customerId, t.soldAt),
    index('sale_date_idx').on(t.businessId, t.soldAt),
  ],
)

export const saleItem = pgTable(
  'sale_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    saleId: bigint('sale_id', { mode: 'number' })
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    /** Set for a serialised line - exactly which handset was sold. */
    deviceId: bigint('device_id', { mode: 'number' }).references(() => deviceUnit.id),

    /**
     * Snapshots taken at the moment of sale. A product can be renamed and a
     * device reclassified later; a reprinted invoice must still read as it
     * did on the day.
     */
    description: text('description'),
    identifierSnapshot: text('identifier_snapshot'),
    /** HSN/SAC at sale time. A product's code can be corrected later; the
     *  invoice already issued must keep the one it was printed with. */
    hsnCodeSnapshot: text('hsn_code_snapshot'),
    mainTypeSnapshot: mainTypeEnum('main_type_snapshot'),
    isNewCutSnapshot: boolean('is_new_cut_snapshot').notNull().default(false),

    quantity: integer('quantity').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'bigint' }).notNull(),
    discountPaise: bigint('discount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxRateId: bigint('tax_rate_id', { mode: 'number' }).references(() => taxRate.id),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
    taxablePaise: bigint('taxable_paise', { mode: 'bigint' }).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    /** The statutory split of this line's tax. cgst + sgst + igst == tax. */
    cgstPaise: bigint('cgst_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    sgstPaise: bigint('sgst_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    igstPaise: bigint('igst_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    lineTotalPaise: bigint('line_total_paise', { mode: 'bigint' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sale_item_sale_idx').on(t.saleId),
    index('sale_item_product_idx').on(t.productId),
    /*
     * Deliberately an ordinary index, not unique. M4 made it unique so a
     * handset could not be billed twice - but M6 lets a device be returned,
     * inspected and sold again, which is a second sale line for the same
     * device and entirely legitimate.
     *
     * Double-selling is prevented where it actually matters: createSale moves
     * the device with a conditional update on expectedStatus = IN_STOCK, so a
     * second till changes no rows and is refused. That is transactional and
     * covered by M4's "two tills cannot sell the same handset" test.
     */
    index('sale_item_device_idx').on(t.deviceId),
  ],
)

/** Split payment across methods on one bill (PRD FR-6.8). */
export const salePayment = pgTable(
  'sale_payment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    saleId: bigint('sale_id', { mode: 'number' })
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    paymentMethodId: bigint('payment_method_id', { mode: 'number' })
      .notNull()
      .references(() => paymentMethod.id),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sale_payment_sale_idx').on(t.saleId)],
)

export type Sale = typeof sale.$inferSelect
export type SaleItem = typeof saleItem.$inferSelect
export type SalePayment = typeof salePayment.$inferSelect

export type Purchase = typeof purchase.$inferSelect
export type PurchaseItem = typeof purchaseItem.$inferSelect
export type SupplierPayment = typeof supplierPayment.$inferSelect
export type SupplierLedgerEntry = typeof supplierLedgerEntry.$inferSelect
export type PurchaseStatus = (typeof purchaseStatusEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]

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

/* ============================================================ M5 — credit ===

   What customers owe. Mirrors the supplier side deliberately: the same shape
   means one mental model, and a fix to allocation or voiding lands on both.
   ========================================================================== */

/**
 * The customer's account (PRD FR-7.4, FR-7.6).
 *
 * Append-only, enforced by a database trigger. The balance is ALWAYS the sum
 * of these rows and never a stored counter, so a disagreement between the
 * screen and the books is impossible rather than merely unlikely.
 */
export const customerLedgerEntry = pgTable(
  'customer_ledger_entry',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' }).notNull(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    /**
     * PRD FR-7.5. For a SALE this is where it was billed; for a PAYMENT it is
     * where the money was actually collected, which may be a different shop.
     */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    entryType: customerLedgerEnum('entry_type').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    note: text('note'),
    actorId: bigint('actor_id', { mode: 'number' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_ledger_customer_idx').on(t.customerId, t.occurredAt),
    index('customer_ledger_ref_idx').on(t.refType, t.refId),
    index('customer_ledger_branch_idx').on(t.branchId, t.occurredAt),
  ],
)

/** Money collected from a customer after the sale (PRD FR-7.3). */
export const customerPayment = pgTable(
  'customer_payment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    /** PRD FR-7.5. Where the money was taken, not where the sale happened. */
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    paymentMethodId: bigint('payment_method_id', { mode: 'number' })
      .notNull()
      .references(() => paymentMethod.id),
    /** Gapless per-branch series, same machinery as invoices. */
    receiptNumber: text('receipt_number').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    receivedOn: timestamp('received_on', { withTimezone: true }).notNull().defaultNow(),
    reference: text('reference'),
    notes: text('notes'),
    /** Voided rather than deleted (docs/02 §2.2 rule 4). */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('customer_payment_customer_idx').on(t.customerId, t.receivedOn),
    index('customer_payment_branch_idx').on(t.branchId, t.receivedOn),
    uniqueIndex('customer_payment_receipt_uq').on(t.businessId, t.receiptNumber),
  ],
)

/**
 * Which invoices a payment settled (PRD FR-7.3).
 *
 * Unallocated money is an advance: it still reduces the balance, it just is
 * not tied to a particular bill yet.
 */
export const customerPaymentAllocation = pgTable(
  'customer_payment_allocation',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => customerPayment.id, { onDelete: 'cascade' }),
    saleId: bigint('sale_id', { mode: 'number' })
      .notNull()
      .references(() => sale.id),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_allocation_payment_idx').on(t.paymentId),
    index('customer_allocation_sale_idx').on(t.saleId),
  ],
)

/* =================================================== M6 — returns & trade-in ===

   Goods coming back, and old phones coming in. The rule that shapes these
   tables: a returned handset is never immediately sellable again. It lands in
   RETURNED and only an authorised inspection can release it (PRD FR-8.2).
   ========================================================================== */

/** PRD FR-8.1. One return against one sale; full, partial or exchange. */
export const salesReturn = pgTable(
  'sales_return',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    saleId: bigint('sale_id', { mode: 'number' })
      .notNull()
      .references(() => sale.id),
    /** Where the goods came back to — need not be where they were sold. */
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    /** Gapless per-branch series, same machinery as invoices and receipts. */
    returnNumber: text('return_number').notNull(),
    returnType: returnTypeEnum('return_type').notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason'),

    /** What the returned goods were worth, and what was actually given back. */
    subtotalPaise: bigint('subtotal_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    /**
     * A restocking fee or deduction. Kept separate from the line figures so
     * the invoice arithmetic still reconciles and the deduction is visible.
     */
    deductionPaise: bigint('deduction_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    refundedPaise: bigint('refunded_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    notes: text('notes'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('sales_return_sale_idx').on(t.saleId),
    index('sales_return_customer_idx').on(t.customerId, t.returnedAt),
    index('sales_return_branch_idx').on(t.branchId, t.returnedAt),
    uniqueIndex('sales_return_number_uq').on(t.businessId, t.returnNumber),
  ],
)

/** One line of a return, pointing at the sale line it reverses. */
export const returnItem = pgTable(
  'return_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    returnId: bigint('return_id', { mode: 'number' })
      .notNull()
      .references(() => salesReturn.id, { onDelete: 'cascade' }),
    /** The line being returned. A partial return names only some of them. */
    saleItemId: bigint('sale_item_id', { mode: 'number' })
      .notNull()
      .references(() => saleItem.id),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    /** Present for a serialised line: the exact handset coming back. */
    deviceId: bigint('device_id', { mode: 'number' }).references(() => deviceUnit.id),
    description: text('description'),
    identifierSnapshot: text('identifier_snapshot'),
    quantity: integer('quantity').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'bigint' }).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    lineTotalPaise: bigint('line_total_paise', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('return_item_return_idx').on(t.returnId),
    index('return_item_sale_item_idx').on(t.saleItemId),
    index('return_item_device_idx').on(t.deviceId),
  ],
)

/**
 * PRD FR-8.5. Money going back to the customer.
 *
 * Either out through a payment method, or credited to the customer's account
 * — which is the right answer when the sale itself was never paid for.
 */
export const refund = pgTable(
  'refund',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    returnId: bigint('return_id', { mode: 'number' })
      .notNull()
      .references(() => salesReturn.id, { onDelete: 'cascade' }),
    /** Where the money physically left from (PRD FR-8.5). */
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    method: refundMethodEnum('method').notNull(),
    /** Null when the refund went to the customer's account rather than out. */
    paymentMethodId: bigint('payment_method_id', { mode: 'number' }).references(
      () => paymentMethod.id,
    ),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    reference: text('reference'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('refund_return_idx').on(t.returnId),
    index('refund_branch_idx').on(t.branchId, t.refundedAt),
  ],
)

/**
 * PRD FR-9.1 – FR-9.3. An old phone taken in against a new sale.
 *
 * The handset itself becomes a normal device unit in the receiving branch with
 * its own event chain, so from that moment it behaves like any other stock.
 * This row records the deal: what it was valued at, what was agreed, and which
 * sale it was set against.
 */
export const tradeIn = pgTable(
  'trade_in',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    /** The sale the trade-in was applied to. Null while still being quoted. */
    saleId: bigint('sale_id', { mode: 'number' }).references(() => sale.id),
    /** The device unit created for the handset taken in. */
    deviceId: bigint('device_id', { mode: 'number' }).references(() => deviceUnit.id),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),

    /** What the shop thought it was worth, and what was actually agreed. */
    estimatedValuePaise: bigint('estimated_value_paise', { mode: 'bigint' }),
    agreedValuePaise: bigint('agreed_value_paise', { mode: 'bigint' }).notNull(),
    conditionNotes: text('condition_notes'),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('trade_in_sale_idx').on(t.saleId),
    index('trade_in_customer_idx').on(t.customerId, t.acceptedAt),
    index('trade_in_branch_idx').on(t.branchId, t.acceptedAt),
  ],
)

/* ============================================================ M7 money === */

/**
 * A bank, UPI or card account (PRD FR-12.1, FR-12.2).
 *
 * Money that is not physically in a till lives here. An account may belong to
 * one branch or be shared across the business, which is what `branch_id` being
 * nullable means - null is "the whole business".
 *
 * The balance is NOT a column. It is the sum of `account_transaction`
 * (docs/03 §4.2), so it can always be proved from the movements.
 */
export const account = pgTable(
  'account',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    /** Null means the account is shared by every branch (FR-12.2). */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    accountNumber: text('account_number'),
    bankName: text('bank_name'),
    ifsc: text('ifsc'),
    upiId: text('upi_id'),
    /** What the account held on the day it was added to the system. */
    openingBalancePaise: bigint('opening_balance_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /**
     * FR-12.4. The last statement balance the owner confirmed, and when. The
     * gap between this and the derived balance is what reconciliation shows.
     */
    reconciledBalancePaise: bigint('reconciled_balance_paise', { mode: 'bigint' }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledBy: bigint('reconciled_by', { mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_business_name_uq').on(t.businessId, t.name),
    index('account_branch_idx').on(t.branchId),
  ],
)

/**
 * Every movement through an account (PRD FR-12.3). Append-only.
 *
 * Signed: positive is money in, negative is money out. One transfer writes two
 * rows linked by `transfer_group`, so both sides always move together and a
 * half-finished transfer cannot exist.
 */
export const accountTransaction = pgTable(
  'account_transaction',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    accountId: bigint('account_id', { mode: 'number' })
      .notNull()
      .references(() => account.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    movement: moneyMovementEnum('movement').notNull(),
    /** Positive in, negative out. Always paise (docs/03 §4.1). */
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    /** The business day this belongs to, which is not always today's date. */
    businessDate: date('business_date').notNull(),
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    /** Both legs of one transfer share this. */
    transferGroup: text('transfer_group'),
    note: text('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('account_txn_account_idx').on(t.accountId, t.businessDate),
    index('account_txn_business_idx').on(t.businessId, t.businessDate),
    index('account_txn_ref_idx').on(t.refType, t.refId),
    index('account_txn_transfer_idx').on(t.transferGroup),
  ],
)

/**
 * One cash drawer per branch per business day (PRD FR-11.1).
 *
 * Opened on the first cash movement of the day rather than by anyone pressing
 * a button, so a counter that starts selling has a drawer whether or not
 * someone remembered to open one.
 */
export const cashDrawerDay = pgTable(
  'cash_drawer_day',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    businessDate: date('business_date').notNull(),
    /**
     * FR-11.3. Carried from the previous day's COUNTED cash, not its expected
     * cash - the drawer starts with what is actually in it.
     */
    openingPaise: bigint('opening_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    status: drawerStatusEnum('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cash_drawer_day_uq').on(t.branchId, t.businessDate),
    index('cash_drawer_day_business_idx').on(t.businessId, t.businessDate),
  ],
)

/**
 * Every rupee in or out of a till (PRD FR-11.2). Append-only.
 *
 * Signed, like `account_transaction`: positive in, negative out. Expected cash
 * is the opening balance plus the sum of these (FR-11.3) - never a stored
 * counter, so it cannot drift from the movements it claims to summarise.
 */
export const cashMovement = pgTable(
  'cash_movement',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    drawerDayId: bigint('drawer_day_id', { mode: 'number' })
      .notNull()
      .references(() => cashDrawerDay.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    movement: moneyMovementEnum('movement').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    refType: text('ref_type'),
    refId: bigint('ref_id', { mode: 'number' }),
    note: text('note'),
    /**
     * PRD OQ-5. True when this landed in a day that was already closed. The
     * closing keeps the figures it was signed with; this flag is what makes
     * the difference between them visible instead of silent.
     */
    postedAfterClose: boolean('posted_after_close').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('cash_movement_day_idx').on(t.drawerDayId),
    index('cash_movement_branch_idx').on(t.branchId, t.occurredAt),
    index('cash_movement_ref_idx').on(t.refType, t.refId),
  ],
)

/** Shop running costs (PRD FR-10.1 – FR-10.3). */
export const expense = pgTable(
  'expense',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => expenseCategory.id),
    /** How it was paid. A cash method hits the drawer, anything else an account. */
    paymentMethodId: bigint('payment_method_id', { mode: 'number' })
      .notNull()
      .references(() => paymentMethod.id),
    /** Set when the money left an account rather than the till. */
    accountId: bigint('account_id', { mode: 'number' }).references(() => account.id),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    businessDate: date('business_date').notNull(),
    description: text('description'),
    reference: text('reference'),
    /** OQ-5. Recorded into a day that had already been closed. */
    postedAfterClose: boolean('posted_after_close').notNull().default(false),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('expense_branch_date_idx').on(t.branchId, t.businessDate),
    index('expense_business_date_idx').on(t.businessId, t.businessDate),
    index('expense_category_idx').on(t.categoryId),
  ],
)

/**
 * The end of a day for one branch (PRD FR-13.1 – FR-13.5).
 *
 * The figures here are STAMPED, not derived (PRD OQ-5, docs/03 §4.9). A
 * closing is a person counting the money and signing that it matched; if a
 * later correction could rewrite it, the signature would mean nothing and a
 * till shortage could be hidden by adjusting an earlier day. Reports recompute
 * from the movements and so do reflect corrections - the two are meant to
 * differ, and `corrected_after_close` is how that is surfaced.
 */
export const dailyClosing = pgTable(
  'daily_closing',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    businessDate: date('business_date').notNull(),

    /** FR-13.2. Cash, as it stood when the drawer was counted. */
    expectedCashPaise: bigint('expected_cash_paise', { mode: 'bigint' }).notNull(),
    countedCashPaise: bigint('counted_cash_paise', { mode: 'bigint' }).notNull(),
    /** Counted less expected. Negative is a shortage (FR-11.4). */
    cashDifferencePaise: bigint('cash_difference_paise', { mode: 'bigint' }).notNull(),

    /**
     * FR-13.1, FR-13.2. The rest of the day as signed off: sales, returns,
     * credit, and expected vs counted for every non-cash method. Held as JSON
     * because it is a frozen statement, never queried across days - the live
     * reports recompute from the movements instead.
     */
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),

    notes: text('notes'),
    /**
     * FR-38. Kept from M12's design, now deferred (docs/02 §2.3): NEW stock
     * is a separate business with its own system, so nothing is imported and
     * ECITY's expected cash is complete for what ECITY billed. These stay so a
     * gate could be added without a migration if the two are ever merged.
     */
    externalFeedImported: boolean('external_feed_imported').notNull().default(false),
    overrideReason: text('override_reason'),

    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: bigint('closed_by', { mode: 'number' }),

    /** OQ-5. Voided so the day could be reopened - never edited in place. */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }),
    voidReason: text('void_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live closing per branch per day. A voided one does not occupy the
    // slot, so a day closed too early can be reopened and closed again.
    uniqueIndex('daily_closing_live_uq')
      .on(t.branchId, t.businessDate)
      .where(sql`voided_at is null`),
    index('daily_closing_business_idx').on(t.businessId, t.businessDate),
  ],
)

/* ======================================================= M8 transfers === */

/**
 * Stock moving between branches (PRD FR-3.6, FR-3.7).
 *
 * The states are the point: while a transfer is in transit the stock belongs
 * to neither branch's sellable inventory. Anything less and the same handset
 * is sellable at both ends of the journey.
 */
export const stockTransfer = pgTable(
  'stock_transfer',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    transferNumber: text('transfer_number').notNull(),
    fromBranchId: bigint('from_branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    toBranchId: bigint('to_branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    status: transferStatusEnum('status').notNull().default('REQUESTED'),
    notes: text('notes'),

    /*
     * Who did what, and when. Kept as columns rather than derived from the
     * audit log because the transfer screen shows them constantly, and a
     * screen that has to read the audit log to render is a slow screen.
     */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestedBy: bigint('requested_by', { mode: 'number' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: bigint('approved_by', { mode: 'number' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    dispatchedBy: bigint('dispatched_by', { mode: 'number' }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    receivedBy: bigint('received_by', { mode: 'number' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: bigint('cancelled_by', { mode: 'number' }),
    cancelReason: text('cancel_reason'),

    /** Something did not arrive, or arrived that should not have. */
    hasDiscrepancy: boolean('has_discrepancy').notNull().default(false),
    discrepancyNotes: text('discrepancy_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_transfer_number_uq').on(t.businessId, t.transferNumber),
    index('stock_transfer_from_idx').on(t.fromBranchId, t.status),
    index('stock_transfer_to_idx').on(t.toBranchId, t.status),
    index('stock_transfer_business_idx').on(t.businessId, t.requestedAt),
  ],
)

/**
 * What is on a transfer.
 *
 * A serialised line is one device and a quantity of one - FR-3.7 requires the
 * exact IMEI to move, so a phone can never be transferred as "one handset".
 * Accessories carry a quantity.
 */
export const transferItem = pgTable(
  'transfer_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    transferId: bigint('transfer_id', { mode: 'number' })
      .notNull()
      .references(() => stockTransfer.id, { onDelete: 'cascade' }),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    /** The exact handset (FR-3.7). Null for accessories. */
    deviceId: bigint('device_id', { mode: 'number' }).references(() => deviceUnit.id),
    quantity: integer('quantity').notNull(),
    /** Filled in at the receiving end. Short of `quantity` is a discrepancy. */
    receivedQuantity: integer('received_quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transfer_item_transfer_idx').on(t.transferId),
    index('transfer_item_device_idx').on(t.deviceId),
  ],
)

/**
 * Correcting what is on the shelf against what the system thinks (FR-28.1 – FR-28.3).
 *
 * An adjustment is the honest record of a difference, not a way to make one
 * disappear: it names the branch, the thing, the reason, the person and the
 * moment, and it is never edited afterwards.
 */
export const stockAdjustment = pgTable(
  'stock_adjustment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => product.id),
    /** Set when the adjustment is about one handset rather than a count. */
    deviceId: bigint('device_id', { mode: 'number' }).references(() => deviceUnit.id),

    reason: adjustmentReasonEnum('reason').notNull(),
    /** Signed, for accessories: negative is stock written off. */
    quantityDelta: integer('quantity_delta').notNull().default(0),
    quantityBefore: integer('quantity_before'),
    quantityAfter: integer('quantity_after'),
    /** For a device: where it ended up. */
    deviceStatusBefore: deviceStatusEnum('device_status_before'),
    deviceStatusAfter: deviceStatusEnum('device_status_after'),

    /*
     * FR-28.2. Snapshotted, not joined: the classification at the moment of
     * the adjustment is part of what is being recorded, and a later correction
     * to the device must not rewrite what this said at the time.
     */
    mainTypeSnapshot: mainTypeEnum('main_type_snapshot'),
    isNewCutSnapshot: boolean('is_new_cut_snapshot').notNull().default(false),

    notes: text('notes'),
    adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [
    index('stock_adjustment_branch_idx').on(t.branchId, t.adjustedAt),
    index('stock_adjustment_business_idx').on(t.businessId, t.adjustedAt),
    index('stock_adjustment_device_idx').on(t.deviceId),
    index('stock_adjustment_product_idx').on(t.productId),
  ],
)

/* ==================================================== M11 import/export === */

/**
 * One uploaded file, and how far it got (PRD FR-34.1 – FR-34.3).
 *
 * The wizard's state lives here rather than in the browser: a file is
 * uploaded, mapped, validated and only then committed, and a browser crash
 * between those steps must not lose a staged batch.
 */
export const importJob = pgTable(
  'import_job',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    kind: importKindEnum('kind').notNull(),
    status: jobStatusEnum('status').notNull().default('UPLOADED'),
    fileName: text('file_name').notNull(),
    /**
     * SHA-256 of the upload. Re-uploading the same file is recognised rather
     * than silently doubling everything in it.
     */
    fileHash: text('file_hash').notNull(),
    /** Where the rows land. Null for records that are not branch-specific. */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),

    /**
     * Which column of theirs feeds which field of ours, as chosen in the
     * wizard. Stored so a re-run uses the same mapping without re-deriving it.
     */
    columnMap: jsonb('column_map').notNull().default(sql`'{}'::jsonb`),
    /** The parsed rows, staged before anything is committed. */
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    committedRows: integer('committed_rows').notNull().default(0),

    /** A structural problem rejects the whole file, and this says why. */
    failureReason: text('failure_reason'),

    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedBy: bigint('uploaded_by', { mode: 'number' }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    committedBy: bigint('committed_by', { mode: 'number' }),
  },
  (t) => [
    index('import_job_business_idx').on(t.businessId, t.uploadedAt),
    index('import_job_hash_idx').on(t.businessId, t.fileHash),
  ],
)

/**
 * One row of an upload: what it said, what we made of it, and what went wrong.
 *
 * Kept for every row, not only the bad ones, because the preview shows what
 * WILL happen before anything is committed - and a row that imported cleanly
 * is still worth being able to trace back to its line in the file.
 */
export const importRow = pgTable(
  'import_row',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: bigint('job_id', { mode: 'number' })
      .notNull()
      .references(() => importJob.id, { onDelete: 'cascade' }),
    /** 1-based, matching what the spreadsheet shows the person. */
    rowNumber: integer('row_number').notNull(),
    /** The untouched source row, so an error can always be explained. */
    raw: jsonb('raw').notNull().default(sql`'{}'::jsonb`),
    /** The row after mapping, in our own shape. */
    parsed: jsonb('parsed'),
    /** Null while valid; otherwise why this row cannot be imported. */
    error: text('error'),
    /** What it created, once committed. */
    appliedRefType: text('applied_ref_type'),
    appliedRefId: bigint('applied_ref_id', { mode: 'number' }),
  },
  (t) => [
    index('import_row_job_idx').on(t.jobId, t.rowNumber),
    index('import_row_error_idx').on(t.jobId, t.error),
  ],
)

/**
 * A generated export (PRD FR-33.1 – FR-33.3).
 *
 * Recorded rather than merely streamed, so "who pulled the customer list, and
 * when" is answerable - a question that matters more once real customer data
 * is in the system.
 */
export const exportJob = pgTable(
  'export_job',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    report: text('report').notNull(),
    format: text('format').notNull(),
    /** The filters it was run with, so the same file can be reproduced. */
    filters: jsonb('filters').notNull().default(sql`'{}'::jsonb`),
    rowCount: integer('row_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (t) => [index('export_job_business_idx').on(t.businessId, t.createdAt)],
)

/**
 * A saved set of report filters (PRD FR-25.4).
 *
 * The shop looks at the same handful of views every week; making them retype
 * a date range and a branch each time is how a report centre stops being used.
 */
export const savedReport = pgTable(
  'saved_report',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: bigint('business_id', { mode: 'number' })
      .notNull()
      .references(() => business.id),
    /** Whose it is. A saved view is personal unless it is shared. */
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    report: text('report').notNull(),
    filters: jsonb('filters').notNull().default(sql`'{}'::jsonb`),
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('saved_report_owner_name_uq').on(t.userId, t.name),
    index('saved_report_business_idx').on(t.businessId),
  ],
)
