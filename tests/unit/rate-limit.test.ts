import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertNotLimited,
  callerKey,
  consume,
  LOGIN_LIMIT,
  resetRateLimits,
  SEARCH_LIMIT,
} from '@/server/rate-limit'

describe('rate limiting', () => {
  beforeEach(() => resetRateLimits())

  it('allows the limit and refuses the one after', () => {
    for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) {
      expect(() => consume('login', '1.2.3.4', LOGIN_LIMIT)).not.toThrow()
    }
    expect(() => consume('login', '1.2.3.4', LOGIN_LIMIT)).toThrow(/too many attempts/i)
  })

  it('says how long to wait, rather than just refusing', () => {
    for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) consume('login', '1.2.3.4', LOGIN_LIMIT)
    expect(() => consume('login', '1.2.3.4', LOGIN_LIMIT)).toThrow(/try again in \d+ second/i)
  })

  it('counts each caller separately', () => {
    for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) consume('login', '1.2.3.4', LOGIN_LIMIT)
    // One shop being attacked must not lock out another.
    expect(() => consume('login', '5.6.7.8', LOGIN_LIMIT)).not.toThrow()
  })

  it('counts each endpoint separately', () => {
    for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) consume('login', 'someone', LOGIN_LIMIT)
    // Failing to sign in must not stop them searching once they are in.
    expect(() => consume('search', 'someone', SEARCH_LIMIT)).not.toThrow()
  })

  it('forgives once the window passes', () => {
    const start = 1_000_000
    for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) {
      consume('login', '1.2.3.4', LOGIN_LIMIT, start)
    }
    expect(() => consume('login', '1.2.3.4', LOGIN_LIMIT, start)).toThrow()
    // A person who mistyped their password is not locked out for the day.
    expect(() =>
      consume('login', '1.2.3.4', LOGIN_LIMIT, start + LOGIN_LIMIT.windowMs + 1),
    ).not.toThrow()
  })

  /*
   * The distinction the browser suite forced: a shop's staff all arrive from
   * one router, so a limit that counted successful sign-ins would lock the
   * shop out of its own till after a power cut. Spraying is all failures.
   */
  describe('checking without counting', () => {
    it('lets an unlimited number of successful sign-ins through', () => {
      for (let i = 0; i < LOGIN_LIMIT.limit * 5; i += 1) {
        // Checked every time, counted never — this is a person who knows
        // their password.
        expect(() => assertNotLimited('login', 'shop-router', LOGIN_LIMIT)).not.toThrow()
      }
    })

    it('refuses once enough attempts have actually failed', () => {
      for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) {
        consume('login', 'attacker', LOGIN_LIMIT)
      }
      expect(() => assertNotLimited('login', 'attacker', LOGIN_LIMIT)).toThrow(/too many/i)
    })

    it('does not lock out a different address', () => {
      for (let i = 0; i < LOGIN_LIMIT.limit; i += 1) consume('login', 'attacker', LOGIN_LIMIT)
      expect(() => assertNotLimited('login', 'the-shop', LOGIN_LIMIT)).not.toThrow()
    })
  })

  describe('identifying the caller', () => {
    it('takes the first address the proxy forwarded', () => {
      const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
      expect(callerKey(headers)).toBe('203.0.113.9')
    })

    it('falls back to one shared bucket rather than to none', () => {
      // A missing header should mean more caution, not an exemption.
      expect(callerKey(new Headers())).toBe('unknown')
    })
  })
})
