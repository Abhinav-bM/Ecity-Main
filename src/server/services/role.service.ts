import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import { appUser, permission, role, rolePermission } from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { isPermissionCode } from '@/lib/permissions'
import type { AuthUser } from '@/server/auth/permissions'

export async function listRoles(actor: AuthUser) {
  const roles = await db
    .select()
    .from(role)
    .where(eq(role.businessId, actor.businessId))
    .orderBy(asc(role.name))

  if (roles.length === 0) return []

  const perms = await db
    .select({ roleId: rolePermission.roleId, code: rolePermission.permissionCode })
    .from(rolePermission)
    .where(
      inArray(
        rolePermission.roleId,
        roles.map((r) => r.id),
      ),
    )

  const byRole = new Map<number, string[]>()
  for (const p of perms) {
    const list = byRole.get(p.roleId) ?? []
    list.push(p.code)
    byRole.set(p.roleId, list)
  }

  return roles.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] }))
}

export async function listPermissionCatalogue() {
  return db.select().from(permission).orderBy(asc(permission.group), asc(permission.label))
}

export async function createRole(
  actor: AuthUser,
  ctx: AuditContext,
  input: { code: string; name: string; description?: string; permissions: string[] },
) {
  const codes = validatePermissions(input.permissions)

  const existing = await db
    .select({ id: role.id })
    .from(role)
    .where(and(eq(role.businessId, actor.businessId), eq(role.code, input.code)))
    .limit(1)
  if (existing[0]) throw conflict('A role with this code already exists.')

  return db.transaction(async (tx) => {
    const created = (
      await tx
        .insert(role)
        .values({
          businessId: actor.businessId,
          code: input.code,
          name: input.name,
          description: input.description || null,
          isSystem: false,
        })
        .returning()
    )[0]!

    if (codes.length > 0) {
      await tx
        .insert(rolePermission)
        .values(codes.map((c) => ({ roleId: created.id, permissionCode: c })))
    }

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'role',
        entityId: created.id,
        summary: `Created role ${created.name}`,
        changes: diff(null, { code: created.code, name: created.name, permissions: codes }),
      },
      tx,
    )
    return { id: created.id }
  })
}

export async function updateRolePermissions(
  actor: AuthUser,
  ctx: AuditContext,
  roleId: number,
  input: { name?: string; description?: string; permissions: string[] },
) {
  const codes = validatePermissions(input.permissions)

  const rows = await db
    .select()
    .from(role)
    .where(and(eq(role.id, roleId), eq(role.businessId, actor.businessId)))
    .limit(1)
  const existing = rows[0]
  if (!existing) throw notFound('Role')

  const currentRows = await db
    .select({ code: rolePermission.permissionCode })
    .from(rolePermission)
    .where(eq(rolePermission.roleId, roleId))
  const current = currentRows.map((r) => r.code).sort()

  // Guard: never leave the business without a role that can manage users.
  if (existing.isSystem && existing.code === 'ADMIN' && !codes.includes('user.manage')) {
    throw new AppError(
      'The Admin role must keep the "Create and edit users" permission.',
      422,
      'ADMIN_LOCKOUT',
    )
  }

  await db.transaction(async (tx) => {
    if (input.name || input.description !== undefined) {
      await tx
        .update(role)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(role.id, roleId))
    }

    await tx.delete(rolePermission).where(eq(rolePermission.roleId, roleId))
    if (codes.length > 0) {
      await tx.insert(rolePermission).values(codes.map((c) => ({ roleId, permissionCode: c })))
    }

    await writeAudit(
      ctx,
      {
        action: 'PERMISSION_CHANGED',
        entityType: 'role',
        entityId: roleId,
        summary: `Updated permissions for ${existing.name}`,
        changes: diff({ permissions: current }, { permissions: [...codes].sort() }),
      },
      tx,
    )
  })
}

export async function deleteRole(actor: AuthUser, ctx: AuditContext, roleId: number) {
  const rows = await db
    .select()
    .from(role)
    .where(and(eq(role.id, roleId), eq(role.businessId, actor.businessId)))
    .limit(1)
  const existing = rows[0]
  if (!existing) throw notFound('Role')
  if (existing.isSystem) throw new AppError('System roles cannot be deleted.', 422, 'SYSTEM_ROLE')

  const inUse = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.roleId, roleId))
    .limit(1)
  if (inUse[0]) {
    throw new AppError(
      'This role is assigned to users. Move them to another role first.',
      422,
      'ROLE_IN_USE',
    )
  }

  await db.transaction(async (tx) => {
    await tx.delete(role).where(eq(role.id, roleId))
    await writeAudit(
      ctx,
      {
        action: 'DELETE',
        entityType: 'role',
        entityId: roleId,
        summary: `Deleted role ${existing.name}`,
      },
      tx,
    )
  })
}

function validatePermissions(codes: string[]): string[] {
  const unknown = codes.filter((c) => !isPermissionCode(c))
  if (unknown.length > 0) {
    throw new AppError(`Unknown permissions: ${unknown.join(', ')}`, 422, 'UNKNOWN_PERMISSION')
  }
  return [...new Set(codes)]
}
