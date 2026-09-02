import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import { branch } from '@/server/db/schema'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * Minimal read-only branch access for M0's branch switcher.
 * M1 owns full branch management (create, edit, deactivate).
 */
export async function listAccessibleBranches(actor: AuthUser) {
  const base = [eq(branch.businessId, actor.businessId), eq(branch.status, 'ACTIVE' as const)]
  const where = actor.canViewAllBranches
    ? and(...base)
    : actor.branchIds.length > 0
      ? and(...base, inArray(branch.id, actor.branchIds))
      : and(...base, eq(branch.id, -1))

  return db
    .select({ id: branch.id, code: branch.code, name: branch.name })
    .from(branch)
    .where(where)
    .orderBy(asc(branch.name))
}
