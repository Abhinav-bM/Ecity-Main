/**
 * The permission catalogue.
 *
 * This file is the single source of truth. `db:seed` writes these rows into
 * the `permission` table, so code and database can never drift.
 *
 * Naming: <area>.<action>. Keep areas aligned with the module breakdown so
 * later modules (M1-M14) add to this list rather than reshaping it.
 */
export const PERMISSIONS = {
  // --- M0 foundations ---
  'user.view': { group: 'Users & access', label: 'View users' },
  'user.manage': { group: 'Users & access', label: 'Create and edit users' },
  'role.view': { group: 'Users & access', label: 'View roles' },
  'role.manage': { group: 'Users & access', label: 'Create and edit roles' },
  'audit.view': { group: 'Users & access', label: 'View the audit log' },
  'session.revoke': { group: 'Users & access', label: 'Revoke other users’ sessions' },

  // --- branch scope ---
  'branch.view': { group: 'Branches', label: 'View branches' },
  'branch.manage': { group: 'Branches', label: 'Create and edit branches' },
  'branch.view_all': {
    group: 'Branches',
    label: 'View all branches (consolidated)',
    description: 'Bypasses per-branch assignment. Owner/Admin only.',
  },

  // --- M1 master data (declared now so roles can be seeded once) ---
  'business.manage': { group: 'Setup', label: 'Edit business profile and tax setup' },
  'customer.view': { group: 'Master data', label: 'View customers' },
  'customer.manage': { group: 'Master data', label: 'Create and edit customers' },
  'supplier.view': { group: 'Master data', label: 'View suppliers' },
  'supplier.manage': { group: 'Master data', label: 'Create and edit suppliers' },
} as const satisfies Record<string, { group: string; label: string; description?: string }>

export type PermissionCode = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[]

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value)
}

/**
 * Seed roles. Admin gets everything; Manager runs a branch; Staff sells.
 * These are starting points - an Admin can edit any of them in the UI.
 */
export const SYSTEM_ROLES = {
  ADMIN: {
    name: 'Admin / Owner',
    description: 'Full access to every branch and every setting.',
    permissions: ALL_PERMISSIONS,
  },
  MANAGER: {
    name: 'Branch Manager',
    description: 'Full operations for the branches they are assigned to.',
    permissions: [
      'user.view',
      'audit.view',
      'branch.view',
      'customer.view',
      'customer.manage',
      'supplier.view',
      'supplier.manage',
    ],
  },
  STAFF: {
    name: 'Staff / Salesperson',
    description: 'Counter staff. No cost prices, no settings, no deletions.',
    permissions: ['branch.view', 'customer.view', 'customer.manage'],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly PermissionCode[] }
>

export type SystemRoleCode = keyof typeof SYSTEM_ROLES
