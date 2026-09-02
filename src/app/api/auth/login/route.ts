import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/validation'
import { login } from '@/server/services/auth.service'
import { setSessionCookie } from '@/server/auth/session'
import { route } from '@/server/http'

export const POST = route({ public: true, schema: loginSchema }, async ({ body }) => {
  const h = await headers()
  const result = await login(body, {
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  })
  await setSessionCookie(result.token)
  return NextResponse.json({ ok: true, mustChangePassword: result.mustChangePassword })
})
