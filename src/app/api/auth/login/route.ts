import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/validation'
import { login } from '@/server/services/auth.service'
import { setSessionCookie } from '@/server/auth/session'
import { route } from '@/server/http'
import { assertNotLimited, callerKey, consume, LOGIN_LIMIT } from '@/server/rate-limit'

export const POST = route({ public: true, schema: loginSchema }, async ({ body }) => {
  const h = await headers()
  const caller = callerKey(h)

  /*
   * Keyed on the caller, and counting **failures only**.
   *
   * The lockout in auth.service stops one account being guessed at, and is
   * blind to the attack that actually happens: one password tried against
   * every account in turn, where no single account ever fails twice. That
   * needs a per-address limit.
   *
   * But a shop's staff all arrive from one router, so counting *successful*
   * logins would lock the shop out of its own till on the morning after a
   * power cut. Spraying is all failures; someone who knows their password is
   * never affected however often they sign in.
   */
  assertNotLimited('login', caller, LOGIN_LIMIT)

  let result
  try {
    result = await login(body, {
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent'),
    })
  } catch (error) {
    consume('login', caller, LOGIN_LIMIT)
    throw error
  }

  await setSessionCookie(result.token)
  return NextResponse.json({ ok: true, mustChangePassword: result.mustChangePassword })
})
