import { headers } from 'next/headers'
import { db, type DbOrTx } from '@/server/db'
import { auditLog } from '@/server/db/schema'
import type { AuthUser } from '@/server/auth/permissions'

type AuditAction = (typeof auditLog.$inferInsert)['action']

export type AuditContext = {
  actor?: Pick<AuthUser, 'id' | 'businessId' | 'name'> | null
  businessId: number
  branchId?: number | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Make a value safe to compare and to store as jsonb.
 *
 * Only bigint needs the treatment - a string keeps the precision that made
 * bigint the right choice, where a number would not. Dates are left alone so
 * the comparison below can still use `getTime`.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value instanceof Date) return value
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    )
  }
  return value
}

/**
 * Compute the changed fields only. Unchanged values are not recorded, which
 * keeps the log readable and small. PRD FR-1.4 / FR-31.1.
 */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: Partial<T>,
  ignore: readonly string[] = ['updatedAt', 'createdAt', 'passwordHash'],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, value] of Object.entries(after)) {
    if (ignore.includes(key)) continue

    /*
     * Absent and empty are the same thing here.
     *
     * A create passes the whole record, so a customer with no email arrives
     * as `email: null` against a `before` of undefined. Comparing those raw
     * made them differ, and the audit log filled with "email: null -> null" -
     * noise that pushed the one field that did change off the screen. Both
     * normalise to null before the comparison and after it.
     */
    /*
     * Money is bigint paise everywhere (docs/03 §4.1), and both the deep
     * comparison below and the jsonb column this ends up in go through
     * JSON.stringify - which throws outright on a bigint. Today's callers all
     * happen to pass only text and ids, so nothing has hit it; the first one
     * to include a price field would have taken down the update it was
     * describing, from inside the transaction, with "Do not know how to
     * serialize a BigInt". Normalising here means a caller never has to know.
     */
    const prev = jsonSafe((before ? before[key] : undefined) ?? null)
    const next = jsonSafe(value ?? null)

    const same =
      prev === next ||
      (prev instanceof Date && next instanceof Date && prev.getTime() === next.getTime()) ||
      JSON.stringify(prev) === JSON.stringify(next)
    if (!same) changes[key] = { from: prev, to: next }
  }
  return changes
}

/**
 * Write one audit row. Accepts a transaction so the audit entry commits or
 * rolls back with the change it describes - docs/02 §2.2 rule 3.
 */
export async function writeAudit(
  ctx: AuditContext,
  entry: {
    action: AuditAction
    entityType: string
    entityId?: string | number | null
    summary?: string
    changes?: Record<string, { from: unknown; to: unknown }>
  },
  tx: DbOrTx = db,
): Promise<void> {
  const changes = entry.changes && Object.keys(entry.changes).length > 0 ? entry.changes : null
  await tx.insert(auditLog).values({
    businessId: ctx.businessId,
    actorUserId: ctx.actor?.id ?? null,
    actorLabel: ctx.actor?.name ?? 'system',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId != null ? String(entry.entityId) : null,
    branchId: ctx.branchId ?? null,
    summary: entry.summary ?? null,
    changes,
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
  })
}

/** Build an audit context from the current request. */
export async function auditContextFromRequest(
  actor: AuthUser | null,
  businessId: number,
  branchId?: number | null,
): Promise<AuditContext> {
  const h = await headers()
  return {
    actor,
    businessId,
    branchId: branchId ?? null,
    ipAddress:
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
  }
}
