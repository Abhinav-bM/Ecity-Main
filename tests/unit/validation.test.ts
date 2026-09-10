import { describe, expect, it } from 'vitest'
import {
  createUserSchema,
  emailSchema,
  productQuerySchema,
  resetPasswordSchema,
} from '@/lib/validation'

describe('email', () => {
  it('lower-cases and trims', () => {
    expect(emailSchema.parse('  Owner@ECity.Local ')).toBe('owner@ecity.local')
  })

  it('rejects nonsense', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow()
  })
})

describe('reset password', () => {
  it('requires the confirmation to match', () => {
    const result = resetPasswordSchema.safeParse({
      token: 't',
      password: 'longenoughpassword',
      confirmPassword: 'different-one-here',
    })
    expect(result.success).toBe(false)
  })
})

describe('create user', () => {
  it('defaults branchIds to an empty list', () => {
    const parsed = createUserSchema.parse({
      name: 'A User',
      email: 'a@b.co',
      roleId: '3',
      password: 'longenoughpassword',
    })
    expect(parsed.branchIds).toEqual([])
    expect(parsed.roleId).toBe(3)
  })
})

describe('the shop day (M9 — found by a test run after midnight IST)', () => {
  it('is the shop’s calendar day, not the browser’s UTC one', async () => {
    const { shopDateString } = await import('@/lib/date')

    /*
     * 18:45 UTC on 7 September is already 00:15 on the 8th in India. Between
     * midnight and 05:30 every night the two disagree, and a form defaulting
     * to the UTC day would post an expense into yesterday - a day that may
     * already be closed - while capping its own picker below the day the shop
     * is actually standing in.
     */
    const lateEvening = new Date('2026-09-07T18:45:00Z')
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-09-07')
    expect(shopDateString(lateEvening)).toBe('2026-09-08')

    // Comfortably inside one day, both agree.
    expect(shopDateString(new Date('2026-09-07T09:00:00Z'))).toBe('2026-09-07')
  })

  it('matches what the server posts money against', async () => {
    const { shopDateString } = await import('@/lib/date')
    const { businessDateFor } = await import('@/server/services/cash.service')
    const when = new Date('2026-09-07T20:10:00Z')
    // One definition, so a form's default and its drawer cannot drift.
    expect(shopDateString(when)).toBe(businessDateFor(when))
  })
})

describe('booleans in a query string', () => {
  it('reads "false" as false, not as a non-empty string', () => {
    // z.coerce.boolean() gets this wrong, which made ?serialised=false mean
    // "serialised only" — the opposite of what was asked.
    expect(productQuerySchema.parse({ serialised: 'false' }).serialised).toBe(false)
    expect(productQuerySchema.parse({ serialised: 'true' }).serialised).toBe(true)
    expect(productQuerySchema.parse({ serialised: '0' }).serialised).toBe(false)
    expect(productQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(false)
  })

  it('still defaults when the parameter is absent', () => {
    expect(productQuerySchema.parse({}).serialised).toBeUndefined()
    expect(productQuerySchema.parse({}).includeInactive).toBe(false)
  })
})

describe('the post-login redirect', () => {
  /**
   * Mirrors `safeNext` in the login form. `?next=` is set by the API client
   * from whatever was in the address bar when a request came back
   * unauthenticated, so a link can carry anything.
   */
  const safeNext = (next: string | null): string => {
    if (!next || !next.startsWith('/')) return '/dashboard'
    if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard'
    return next
  }

  it('returns the user to where they were', () => {
    expect(safeNext('/sales/12')).toBe('/sales/12')
    expect(safeNext('/analytics?from=2026-01-01')).toBe('/analytics?from=2026-01-01')
  })

  it('refuses anywhere outside this app', () => {
    expect(safeNext('https://evil.example')).toBe('/dashboard')
    // Protocol-relative, and the backslash form browsers normalise to it.
    expect(safeNext('//evil.example')).toBe('/dashboard')
    expect(safeNext('/\\evil.example')).toBe('/dashboard')
  })

  it('falls back when there is nothing to go back to', () => {
    expect(safeNext(null)).toBe('/dashboard')
    expect(safeNext('')).toBe('/dashboard')
  })
})
