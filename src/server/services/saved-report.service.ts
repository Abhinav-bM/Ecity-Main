import { and, asc, eq, or } from 'drizzle-orm'
import { db } from '@/server/db'
import { savedReport } from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * Saved report filters (M11 screens; the PRD asks for the report centre,
 * FR-25.1 – FR-25.3, and this is what makes one worth coming back to).
 *
 * A report is a name plus a period plus a branch, and the same three are asked
 * for every morning. The URL already carries them, which is enough to send a
 * view to someone; this is what makes one worth coming back to.
 *
 * Only the filters are kept, never the figures. A saved view re-runs against
 * today's data - a stored result would go stale silently, which is the one
 * thing a report must not do.
 */

export type SavedReportFilters = { from?: string; to?: string; branchId?: string }

export async function listSavedReports(actor: AuthUser) {
  const rows = await db
    .select()
    .from(savedReport)
    .where(
      and(
        eq(savedReport.businessId, actor.businessId),
        // Yours, plus the ones someone chose to share.
        or(eq(savedReport.userId, actor.id), eq(savedReport.isShared, true)),
      ),
    )
    .orderBy(asc(savedReport.name))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    report: r.report,
    filters: r.filters as SavedReportFilters,
    isShared: r.isShared,
    isMine: r.userId === actor.id,
  }))
}

export async function saveReport(
  actor: AuthUser,
  ctx: AuditContext,
  input: { name: string; report: string; filters: SavedReportFilters; isShared?: boolean },
) {
  const existing = (
    await db
      .select({ id: savedReport.id })
      .from(savedReport)
      .where(and(eq(savedReport.userId, actor.id), eq(savedReport.name, input.name)))
      .limit(1)
  )[0]

  /*
   * Saving over a name you already used replaces it rather than being refused.
   * Adjusting a period and saving again is the normal way this is used, and a
   * conflict there would only teach people to write "sales 2", "sales 3".
   */
  if (existing) {
    await db
      .update(savedReport)
      .set({
        report: input.report,
        filters: input.filters,
        isShared: input.isShared ?? false,
      })
      .where(eq(savedReport.id, existing.id))
    return { id: existing.id, replaced: true }
  }

  const created = (
    await db
      .insert(savedReport)
      .values({
        businessId: actor.businessId,
        userId: actor.id,
        name: input.name,
        report: input.report,
        filters: input.filters,
        isShared: input.isShared ?? false,
      })
      .returning({ id: savedReport.id })
  )[0]!

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'saved_report',
    entityId: created.id,
    summary: `Saved the "${input.name}" view of the ${input.report} report`,
  })

  return { id: created.id, replaced: false }
}

export async function deleteSavedReport(actor: AuthUser, ctx: AuditContext, id: number) {
  const row = (
    await db
      .select()
      .from(savedReport)
      .where(and(eq(savedReport.id, id), eq(savedReport.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Saved report')
  // A shared view belongs to whoever made it; anyone else may use it, not bin it.
  if (row.userId !== actor.id) throw new AppError('That view belongs to someone else.', 403, 'FORBIDDEN')

  await db.delete(savedReport).where(eq(savedReport.id, id))
  await writeAudit(ctx, {
    action: 'DELETE',
    entityType: 'saved_report',
    entityId: id,
    summary: `Removed the "${row.name}" saved view`,
  })
  return { id }
}
