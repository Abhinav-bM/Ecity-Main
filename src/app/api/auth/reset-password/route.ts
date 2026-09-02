import { headers } from 'next/headers'
import { resetPasswordSchema } from '@/lib/validation'
import { resetPassword } from '@/server/services/auth.service'
import { route } from '@/server/http'

export const POST = route({ public: true, schema: resetPasswordSchema }, async ({ body }) => {
  const h = await headers()
  await resetPassword(
    { token: body.token, password: body.password },
    {
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent'),
    },
  )
  return { ok: true }
})
