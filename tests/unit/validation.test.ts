import { describe, expect, it } from 'vitest'
import { createUserSchema, emailSchema, resetPasswordSchema } from '@/lib/validation'

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
