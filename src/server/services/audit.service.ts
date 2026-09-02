import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import { auditLog } from '@/server/db/schema'
import { branchScope, type AuthUser } from '@/server/auth/permissions'

export async function listAuditLog(
  actor: AuthUser,
  query: {
    entityType?: string
    actorUserId?: number
    action?: string
    branchId?: number
    page: number
    pageSize: number
  },
) {
  const conditions: SQL[] = [eq(auditLog.businessId, actor.businessId)]

  if (query.entityType) conditions.push(eq(auditLog.entityType, query.entityType))
  if (query.actorUserId) conditions.push(eq(auditLog.actorUserId, query.actorUserId))
  if (query.action) {
    conditions.push(eq(auditLog.action, query.action as typeof auditLog.$inferSelect.action))
  }

  // Branch scoping: a branch-limited user never sees another branch's audit
  // rows. Rows with a null branch (business-wide actions) stay visible.
  const scope = branchScope(actor, query.branchId ?? null)
  if (scope !== null && scope.length > 0) {
    conditions.push(inArray(auditLog.branchId, scope))
  }

  const where = and(...conditions)
  const offset = (query.page - 1) * query.pageSize

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ n: count() }).from(auditLog).where(where),
  ])

  return { rows, total: totals[0]?.n ?? 0, page: query.page, pageSize: query.pageSize }
}
