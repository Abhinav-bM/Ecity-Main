import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { appUser, branch, role, userBranch } from '@/server/db/schema'
import { hashPassword } from '@/server/auth/password'
import { revokeAllSessionsForUser } from '@/server/auth/session'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

export type UserListItem = {
  id: number
  name: string
  email: string
  phone: string | null
  isActive: boolean
  roleName: string
  branches: string[]
  lastLoginAt: Date | null
}

export async function listUsers(actor: AuthUser): Promise<UserListItem[]> {
  const rows = await db
    .select({
      id: appUser.id,
      name: appUser.name,
      email: appUser.email,
      phone: appUser.phone,
      isActive: appUser.isActive,
      roleName: role.name,
      lastLoginAt: appUser.lastLoginAt,
    })
    .from(appUser)
    .innerJoin(role, eq(role.id, appUser.roleId))
    .where(eq(appUser.businessId, actor.businessId))
    .orderBy(desc(appUser.isActive), appUser.name)

  if (rows.length === 0) return []

  const assignments = await db
    .select({ userId: userBranch.userId, branchName: branch.name })
    .from(userBranch)
    .innerJoin(branch, eq(branch.id, userBranch.branchId))
    .where(
      inArray(
        userBranch.userId,
        rows.map((r) => r.id),
      ),
    )

  const byUser = new Map<number, string[]>()
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? []
    list.push(a.branchName)
    byUser.set(a.userId, list)
  }

  return rows.map((r) => ({ ...r, branches: byUser.get(r.id) ?? [] }))
}

export async function getUser(actor: AuthUser, id: number) {
  const rows = await db
    .select()
    .from(appUser)
    .where(and(eq(appUser.id, id), eq(appUser.businessId, actor.businessId)))
    .limit(1)
  const user = rows[0]
  if (!user) throw notFound('User')

  const branches = await db
    .select({ branchId: userBranch.branchId })
    .from(userBranch)
    .where(eq(userBranch.userId, id))

  const { passwordHash: _ignored, ...safe } = user
  return { ...safe, branchIds: branches.map((b) => b.branchId) }
}

async function assertBranchesExist(businessId: number, branchIds: number[]) {
  if (branchIds.length === 0) return
  const found = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.businessId, businessId), inArray(branch.id, branchIds)))
  if (found.length !== new Set(branchIds).size) {
    throw new AppError('One or more selected branches do not exist.', 422, 'INVALID_BRANCH')
  }
}

export async function createUser(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    name: string
    email: string
    phone?: string
    roleId: number
    branchIds: number[]
    password: string
  },
) {
  const existing = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(and(eq(appUser.businessId, actor.businessId), eq(appUser.email, input.email)))
    .limit(1)
  if (existing[0]) throw conflict('A user with this email already exists.')

  const roleRow = await db
    .select({ id: role.id })
    .from(role)
    .where(and(eq(role.id, input.roleId), eq(role.businessId, actor.businessId)))
    .limit(1)
  if (!roleRow[0]) throw new AppError('That role does not exist.', 422, 'INVALID_ROLE')

  await assertBranchesExist(actor.businessId, input.branchIds)

  return db.transaction(async (tx) => {
    const created = (
      await tx
        .insert(appUser)
        .values({
          businessId: actor.businessId,
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          passwordHash: await hashPassword(input.password),
          roleId: input.roleId,
          mustChangePassword: true,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning()
    )[0]!

    if (input.branchIds.length > 0) {
      await tx
        .insert(userBranch)
        .values(input.branchIds.map((b) => ({ userId: created.id, branchId: b })))
    }

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'app_user',
        entityId: created.id,
        summary: `Created user ${created.email}`,
        changes: diff(null, {
          name: created.name,
          email: created.email,
          roleId: created.roleId,
          branchIds: input.branchIds,
        }),
      },
      tx,
    )

    return { id: created.id }
  })
}

export async function updateUser(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: {
    name?: string
    phone?: string
    roleId?: number
    branchIds?: number[]
    isActive?: boolean
  },
) {
  const before = await getUser(actor, id)

  if (input.roleId != null) {
    const roleRow = await db
      .select({ id: role.id })
      .from(role)
      .where(and(eq(role.id, input.roleId), eq(role.businessId, actor.businessId)))
      .limit(1)
    if (!roleRow[0]) throw new AppError('That role does not exist.', 422, 'INVALID_ROLE')
  }
  if (input.branchIds) await assertBranchesExist(actor.businessId, input.branchIds)

  // Do not let the last active admin lock everybody out.
  if (input.isActive === false && id === actor.id) {
    throw new AppError('You cannot deactivate your own account.', 422, 'SELF_DEACTIVATION')
  }

  await db.transaction(async (tx) => {
    const patch: Partial<typeof appUser.$inferInsert> = { updatedAt: new Date(), updatedBy: actor.id }
    if (input.name !== undefined) patch.name = input.name
    if (input.phone !== undefined) patch.phone = input.phone || null
    if (input.roleId !== undefined) patch.roleId = input.roleId
    if (input.isActive !== undefined) patch.isActive = input.isActive

    await tx.update(appUser).set(patch).where(eq(appUser.id, id))

    if (input.branchIds) {
      await tx.delete(userBranch).where(eq(userBranch.userId, id))
      if (input.branchIds.length > 0) {
        await tx.insert(userBranch).values(input.branchIds.map((b) => ({ userId: id, branchId: b })))
      }
    }

    const changes = diff(
      { ...before, branchIds: before.branchIds },
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.branchIds !== undefined ? { branchIds: input.branchIds } : {}),
      },
    )

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'app_user',
        entityId: id,
        summary: `Updated user ${before.email}`,
        changes,
      },
      tx,
    )
  })

  // Role, branch or status changes must take effect immediately, not at the
  // next login - so end the affected user's sessions.
  if (input.roleId !== undefined || input.branchIds !== undefined || input.isActive === false) {
    await revokeAllSessionsForUser(id)
  }
}

export async function resetUserPassword(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  newPassword: string,
) {
  const user = await getUser(actor, id)
  await db
    .update(appUser)
    .set({
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
      updatedBy: actor.id,
    })
    .where(eq(appUser.id, id))

  await writeAudit(ctx, {
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'app_user',
    entityId: id,
    summary: `Password reset by ${actor.name} for ${user.email}`,
  })

  await revokeAllSessionsForUser(id)
}

export async function countActiveAdmins(businessId: number, adminRoleId: number) {
  const rows = await db
    .select({ n: count() })
    .from(appUser)
    .where(
      and(
        eq(appUser.businessId, businessId),
        eq(appUser.roleId, adminRoleId),
        eq(appUser.isActive, true),
      ),
    )
  return rows[0]?.n ?? 0
}

export const _sql = sql
