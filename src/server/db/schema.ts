/**
 * ECITY database schema - Module M0 (Foundations).
 *
 * Scope: business, branches (minimal - M1 owns full branch management),
 * users, roles, permissions, sessions and the audit log.
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
    status: branchStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('branch_business_code_uq').on(t.businessId, t.code)],
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

export type Business = typeof business.$inferSelect
export type Branch = typeof branch.$inferSelect
export type Role = typeof role.$inferSelect
export type AppUser = typeof appUser.$inferSelect
export type Session = typeof session.$inferSelect
export type AuditLog = typeof auditLog.$inferSelect
