import { describe, expect, it } from 'vitest'
import {
  AuthorisationError,
  branchScope,
  canAccessBranch,
  hasPermission,
  requirePermission,
  type AuthUser,
} from '@/server/auth/permissions'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions'
import type { PermissionCode } from '@/lib/permissions'

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    businessId: 1,
    name: 'Test',
    email: 'test@example.com',
    roleId: 1,
    permissions: new Set<PermissionCode>(['user.view']),
    branchIds: [10],
    canViewAllBranches: false,
    ...overrides,
  }
}

describe('hasPermission', () => {
  it('is true only for granted permissions', () => {
    const u = user()
    expect(hasPermission(u, 'user.view')).toBe(true)
    expect(hasPermission(u, 'user.manage')).toBe(false)
  })
})

describe('canAccessBranch', () => {
  it('allows an assigned branch', () => {
    expect(canAccessBranch(user(), 10)).toBe(true)
  })

  it('denies an unassigned branch', () => {
    expect(canAccessBranch(user(), 20)).toBe(false)
  })

  it('allows any branch when the user can view all', () => {
    expect(canAccessBranch(user({ canViewAllBranches: true, branchIds: [] }), 999)).toBe(true)
  })

  it('treats a null branch as a business-wide action', () => {
    expect(canAccessBranch(user(), null)).toBe(true)
  })
})

describe('requirePermission', () => {
  it('passes when permission and branch both check out', () => {
    expect(() => requirePermission(user(), 'user.view', 10)).not.toThrow()
  })

  it('throws when not signed in', () => {
    expect(() => requirePermission(null, 'user.view', 10)).toThrow(AuthorisationError)
  })

  it('throws when the permission is missing', () => {
    expect(() => requirePermission(user(), 'user.manage', 10)).toThrow(/Missing permission/)
  })

  it('throws when the branch is out of scope, even with the permission', () => {
    // The critical case: right permission, wrong branch.
    expect(() => requirePermission(user(), 'user.view', 20)).toThrow(/do not have access/)
  })
})

describe('branchScope', () => {
  it('returns null (no filter) for a user who sees everything', () => {
    expect(branchScope(user({ canViewAllBranches: true }))).toBeNull()
  })

  it('limits to assigned branches when none is requested', () => {
    expect(branchScope(user({ branchIds: [10, 11] }))).toEqual([10, 11])
  })

  it('honours a specific in-scope request', () => {
    expect(branchScope(user({ branchIds: [10, 11] }), 11)).toEqual([11])
  })

  it('refuses an out-of-scope request rather than silently widening', () => {
    expect(() => branchScope(user({ branchIds: [10] }), 99)).toThrow(AuthorisationError)
  })
})

describe('seed roles', () => {
  it('gives Admin every permission', () => {
    expect([...SYSTEM_ROLES.ADMIN.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('does not give Staff any management permission', () => {
    const staff = SYSTEM_ROLES.STAFF.permissions as readonly string[]
    // customer_payment.manage is deliberate: taking money against an old bill
    // is the counter's job. Voiding one is not - see customer_payment.void.
    expect(
      staff.filter(
        (p) => p.endsWith('.manage') && !['customer.manage', 'customer_payment.manage'].includes(p),
      ),
    ).toEqual([])
    // Collecting is allowed; erasing a collection is not.
    expect(staff).not.toContain('customer_payment.void')
    expect(staff).not.toContain('branch.view_all')
    expect(staff).not.toContain('audit.view')
  })

  it('never grants Manager the consolidated all-branch view', () => {
    expect(SYSTEM_ROLES.MANAGER.permissions as readonly string[]).not.toContain('branch.view_all')
  })
})
