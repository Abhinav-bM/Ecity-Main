import { AppError } from '@/server/http'

/**
 * A per-caller limit on how often an endpoint may be hit (M14 hardening).
 *
 * The account lockout in `auth.service` stops somebody guessing one person's
 * password. It is blind to the attack that actually happens: the *same*
 * password tried against every account in turn, which never trips a
 * per-account counter because no single account fails twice. That needs a
 * limit on the caller, so this is keyed on the address.
 *
 * **In memory, per process, on purpose.** The shop runs one app container
 * (docs/04 §4.1), so a module-level map is the whole mechanism and costs no
 * dependency, no table and nothing else to keep running. It has two honest
 * limits, both acceptable here and neither acceptable silently:
 *
 *   - a restart clears the counters, which at worst gives an attacker one
 *     more window;
 *   - a second app instance would count separately, so the effective limit
 *     doubles. If this is ever scaled out, this moves to Redis or a table.
 *
 * It is not a defence against a determined distributed attacker. It is a
 * defence against a script, which is what a small shop on the public internet
 * actually meets.
 */

type Window = { count: number; resetAt: number }

const windows = new Map<string, Window>()

/** Stop the map growing without bound on a long-running process. */
function sweep(now: number) {
  if (windows.size < 5_000) return
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

export type RateLimit = {
  /** How many are allowed in the window. */
  limit: number
  /** How long the window is, in milliseconds. */
  windowMs: number
}

/**
 * Failed sign-ins from one address.
 *
 * Counted on **failure only**, which is the whole design. A shop's staff all
 * arrive from one address — a single router — so counting successful logins
 * would lock the shop out of its own till on the morning after a power cut,
 * when eight people sign in at once. The browser test suite found exactly
 * that by behaving like ten staff on one connection.
 *
 * Password spraying, the attack this is for, is *all* failures: the same
 * password tried against account after account, none of which succeed. So
 * failures are what is counted, and a person who knows their password is
 * never affected however many times they sign in.
 */
export const LOGIN_LIMIT: RateLimit = { limit: 20, windowMs: 60_000 }

/**
 * Search is authenticated, so this is about load rather than intrusion — the
 * global search touches every table at once. Generous enough that a fast
 * typist with a debounce never sees it.
 */
export const SEARCH_LIMIT: RateLimit = { limit: 60, windowMs: 60_000 }

/**
 * Is this caller already over the limit? Throws 429 if so, counts nothing.
 *
 * Paired with `consume` for endpoints that should only count failures: check
 * before doing the work, record after it goes wrong.
 */
export function assertNotLimited(bucket: string, key: string, limit: RateLimit, now = Date.now()) {
  const window = windows.get(`${bucket}:${key}`)
  if (!window || window.resetAt <= now || window.count < limit.limit) return

  const seconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000))
  throw new AppError(
    `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    429,
    'RATE_LIMITED',
  )
}

/**
 * Count one call. Throws 429 when the caller has had too many.
 *
 * Returns how many remain, which the caller can put in a header if it wants
 * to be polite about it.
 */
export function consume(bucket: string, key: string, limit: RateLimit, now = Date.now()): number {
  sweep(now)

  const id = `${bucket}:${key}`
  const existing = windows.get(id)

  if (!existing || existing.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + limit.windowMs })
    return limit.limit - 1
  }

  existing.count += 1
  if (existing.count > limit.limit) {
    const seconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    throw new AppError(
      `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      429,
      'RATE_LIMITED',
    )
  }
  return limit.limit - existing.count
}

/**
 * Who is calling, as best the proxy can tell us.
 *
 * Caddy sets `x-forwarded-for` (docs/04 §4.2). Falling back to a single
 * shared bucket when there is no address is deliberate: a missing header
 * should mean *more* caution, not none, even though it means one unknown
 * caller can rate-limit another. That trade is right for a login endpoint.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip') || 'unknown'
}

/** For tests: forget every counter. */
export function resetRateLimits(): void {
  windows.clear()
}
