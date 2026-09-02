import { describe, expect, it } from 'vitest'
import { hashPassword, passwordProblems, verifyPassword } from '@/server/auth/password'

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
  })

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same password')
    const b = await hashPassword('same password')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same password', a)).toBe(true)
    expect(await verifyPassword('same password', b)).toBe(true)
  })

  it('does not throw on a malformed stored hash', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$abc')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })

  it('normalises unicode so the same typed password matches', async () => {
    const composed = 'passwörd123'.normalize('NFC')
    const decomposed = 'passwörd123'.normalize('NFD')
    const hash = await hashPassword(composed)
    expect(await verifyPassword(decomposed, hash)).toBe(true)
  })
})

describe('password policy', () => {
  it('requires at least 10 characters', () => {
    expect(passwordProblems('short')).toContain('Must be at least 10 characters long.')
    expect(passwordProblems('longenough1')).toEqual([])
  })

  it('rejects padding and repetition', () => {
    expect(passwordProblems(' leadingspace')).not.toEqual([])
    expect(passwordProblems('aaaaaaaaaaaa')).not.toEqual([])
  })
})
