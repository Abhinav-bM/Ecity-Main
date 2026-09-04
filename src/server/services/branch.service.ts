import { and, asc, count, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/server/db'
import { appUser, branch, userBranch } from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * Branch management (PRD FR-3.1, FR-3.8).
 *
 * The rule that matters: a deactivated branch keeps every historical record
 * and stays readable, but can never be chosen for a new transaction. Nothing
 * is ever deleted.
 */

/** Branches the user may act in. Used by the header switcher. */
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

export type BranchListItem = {
  id: number
  code: string
  name: string
  city: string | null
  phone: string | null
  status: 'ACTIVE' | 'INACTIVE'
  managerName: string | null
  userCount: number
}

/** The management list. Shows inactive branches too - they remain readable. */
export async function listBranches(actor: AuthUser): Promise<BranchListItem[]> {
  const rows = await db
    .select({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      city: branch.city,
      phone: branch.phone,
      status: branch.status,
      managerName: appUser.name,
    })
    .from(branch)
    .leftJoin(appUser, eq(appUser.id, branch.managerUserId))
    .where(eq(branch.businessId, actor.businessId))
    .orderBy(asc(branch.status), asc(branch.name))

  if (rows.length === 0) return []

  const counts = await db
    .select({ branchId: userBranch.branchId, n: count() })
    .from(userBranch)
    .where(
      inArray(
        userBranch.branchId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(userBranch.branchId)

  const byBranch = new Map(counts.map((c) => [c.branchId, c.n]))
  return rows.map((r) => ({ ...r, userCount: byBranch.get(r.id) ?? 0 }))
}

export async function getBranch(actor: AuthUser, id: number) {
  const rows = await db
    .select()
    .from(branch)
    .where(and(eq(branch.id, id), eq(branch.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Branch')
  return row
}

export type BranchInput = {
  code: string
  name: string
  phone?: string
  email?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  gstin?: string
  invoicePrefix?: string
  managerUserId?: number | null
  notes?: string
}

function normalise(input: BranchInput) {
  const clean = <T extends string | undefined>(v: T) => (v?.trim() ? v.trim() : null)
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    phone: clean(input.phone),
    email: clean(input.email)?.toLowerCase() ?? null,
    addressLine1: clean(input.addressLine1),
    addressLine2: clean(input.addressLine2),
    city: clean(input.city),
    state: clean(input.state),
    pincode: clean(input.pincode),
    gstin: clean(input.gstin)?.toUpperCase() ?? null,
    invoicePrefix: clean(input.invoicePrefix)?.toUpperCase() ?? null,
    notes: clean(input.notes),
  }
}

async function assertCodeFree(businessId: number, code: string, excludeId?: number) {
  const found = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.businessId, businessId), eq(branch.code, code)))
    .limit(1)
  if (found[0] && found[0].id !== excludeId) {
    throw conflict(`Branch code ${code} is already in use.`)
  }
}

async function assertManagerValid(actor: AuthUser, managerUserId: number | null | undefined) {
  if (managerUserId == null) return
  const found = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(
      and(
        eq(appUser.id, managerUserId),
        eq(appUser.businessId, actor.businessId),
        eq(appUser.isActive, true),
      ),
    )
    .limit(1)
  if (!found[0]) throw new AppError('That manager does not exist.', 422, 'INVALID_MANAGER')
}

export async function createBranch(actor: AuthUser, ctx: AuditContext, input: BranchInput) {
  const values = normalise(input)
  await assertCodeFree(actor.businessId, values.code)
  await assertManagerValid(actor, input.managerUserId)

  const created = (
    await db
      .insert(branch)
      .values({
        businessId: actor.businessId,
        ...values,
        managerUserId: input.managerUserId ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning()
  )[0]!

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'branch',
    entityId: created.id,
    summary: `Created branch ${created.code} — ${created.name}`,
    changes: diff(null, { code: created.code, name: created.name }),
  })
  return { id: created.id }
}

export async function updateBranch(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: BranchInput,
) {
  const before = await getBranch(actor, id)
  const values = normalise(input)
  await assertCodeFree(actor.businessId, values.code, id)
  await assertManagerValid(actor, input.managerUserId)

  await db
    .update(branch)
    .set({
      ...values,
      managerUserId: input.managerUserId ?? null,
      updatedAt: new Date(),
      updatedBy: actor.id,
    })
    .where(eq(branch.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'branch',
    entityId: id,
    summary: `Updated branch ${values.code}`,
    changes: diff(before, { ...values, managerUserId: input.managerUserId ?? null }),
  })
}

/**
 * PRD FR-3.8. Deactivating keeps all history and all user assignments; it only
 * removes the branch from pickers. Reactivation is always possible, which is
 * why this is a status flip and not a delete.
 */
export async function setBranchStatus(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  status: 'ACTIVE' | 'INACTIVE',
) {
  const before = await getBranch(actor, id)
  if (before.status === status) return

  if (status === 'INACTIVE') {
    // A business with no active branch cannot trade at all.
    const others = await db
      .select({ n: count() })
      .from(branch)
      .where(
        and(
          eq(branch.businessId, actor.businessId),
          eq(branch.status, 'ACTIVE'),
          ne(branch.id, id),
        ),
      )
    if ((others[0]?.n ?? 0) === 0) {
      throw new AppError(
        'At least one branch must stay active.',
        422,
        'LAST_ACTIVE_BRANCH',
      )
    }
  }

  await db
    .update(branch)
    .set({ status, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(branch.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'branch',
    entityId: id,
    summary: `${status === 'ACTIVE' ? 'Reactivated' : 'Deactivated'} branch ${before.code}`,
    changes: diff({ status: before.status }, { status }),
  })
}

/**
 * The guard every later module calls before writing a transaction. Stock,
 * sales, purchases and cash all route through this, so FR-3.8 is enforced in
 * one place rather than remembered in twelve.
 */
export async function assertBranchAcceptsTransactions(actor: AuthUser, branchId: number) {
  const row = await getBranch(actor, branchId)
  if (row.status !== 'ACTIVE') {
    throw new AppError(
      `Branch ${row.code} is deactivated and cannot accept new transactions.`,
      422,
      'BRANCH_INACTIVE',
    )
  }
  return row
}
