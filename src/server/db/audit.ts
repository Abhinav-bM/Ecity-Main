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
 * Compute the changed fields only. Unchanged values are not recorded, which
 * keeps the log readable and small. PRD FR-1.4 / FR-31.1.
 */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: Partial<T>,
  ignore: readonly string[] = ['updatedAt', 'createdAt', 'passwordHash'],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, next] of Object.entries(after)) {
    if (ignore.includes(key)) continue
    const prev = before ? before[key] : undefined
    const same =
      prev === next ||
      (prev instanceof Date && next instanceof Date && prev.getTime() === next.getTime()) ||
      JSON.stringify(prev) === JSON.stringify(next)
    if (!same) changes[key] = { from: prev ?? null, to: next ?? null }
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
