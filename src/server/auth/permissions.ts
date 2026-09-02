import { and, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { rolePermission, userBranch } from '@/server/db/schema'
import type { PermissionCode } from '@/lib/permissions'

/**
 * Authorisation. Two independent checks, both required, both server-side:
 *
 *   1. Does the user's effective role carry the permission?
 *   2. Is the user allowed to act in the branch being touched?
 *
 * docs/02 §2.2 rule 1: the UI hiding a button is never the control.
 */

export class AuthorisationError extends Error {
  readonly status = 403
  constructor(
    message: string,
    readonly permission?: PermissionCode,
    readonly branchId?: number | null,
  ) {
    super(message)
    this.name = 'AuthorisationError'
  }
}

export type AuthUser = {
  id: number
  businessId: number
  name: string
  email: string
  roleId: number
  /** Permissions granted by the user's default role. */
  permissions: Set<PermissionCode>
  /** Branch ids the user is assigned to. Empty when they can view all. */
  branchIds: number[]
  /** True when the user holds branch.view_all. */
  canViewAllBranches: boolean
}

export function hasPermission(user: AuthUser, permission: PermissionCode): boolean {
  return user.permissions.has(permission)
}

/** Can this user act in this branch at all? `null` means a business-wide action. */
export function canAccessBranch(user: AuthUser, branchId: number | null | undefined): boolean {
  if (branchId == null) return true
  if (user.canViewAllBranches) return true
  return user.branchIds.includes(branchId)
}

/**
 * The single gate every route handler and server action must call first.
 * Throws AuthorisationError, which the http wrapper turns into a 403.
 */
export function requirePermission(
  user: AuthUser | null,
  permission: PermissionCode,
  branchId?: number | null,
): asserts user is AuthUser {
  if (!user) throw new AuthorisationError('Not signed in.', permission, branchId)
  if (!hasPermission(user, permission)) {
    throw new AuthorisationError(
      `Missing permission: ${permission}.`,
      permission,
      branchId,
    )
  }
  if (!canAccessBranch(user, branchId)) {
    throw new AuthorisationError(
      'You do not have access to this branch.',
      permission,
      branchId,
    )
  }
}

/**
 * Effective permissions for a user *in a specific branch*, honouring a
 * per-branch role override (userBranch.roleId). Falls back to the default role.
 */
export async function effectivePermissionsInBranch(
  userId: number,
  defaultRoleId: number,
  branchId: number | null,
): Promise<Set<PermissionCode>> {
  let roleId = defaultRoleId
  if (branchId != null) {
    const override = await db
      .select({ roleId: userBranch.roleId })
      .from(userBranch)
      .where(and(eq(userBranch.userId, userId), eq(userBranch.branchId, branchId)))
      .limit(1)
    if (override[0]?.roleId != null) roleId = override[0].roleId
  }
  return permissionsForRole(roleId)
}

export async function permissionsForRole(roleId: number): Promise<Set<PermissionCode>> {
  const rows = await db
    .select({ code: rolePermission.permissionCode })
    .from(rolePermission)
    .where(eq(rolePermission.roleId, roleId))
  return new Set(rows.map((r) => r.code as PermissionCode))
}

/**
 * The branch filter to apply to a query.
 * Returns `null` for "no filter" (user may see everything).
 */
export function branchScope(user: AuthUser, requested?: number | null): number[] | null {
  if (requested != null) {
    if (!canAccessBranch(user, requested)) {
      throw new AuthorisationError('You do not have access to this branch.', undefined, requested)
    }
    return [requested]
  }
  if (user.canViewAllBranches) return null
  return user.branchIds
}
