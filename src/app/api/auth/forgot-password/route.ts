import { headers } from 'next/headers'
import { forgotPasswordSchema } from '@/lib/validation'
import { requestPasswordReset } from '@/server/services/auth.service'
import { route } from '@/server/http'
import { callerKey, consume, LOGIN_LIMIT } from '@/server/rate-limit'

export const POST = route(
  { public: true, schema: forgotPasswordSchema },
  async ({ body }) => {
    const h = await headers()
    // Unauthenticated and it sends mail: without a limit it is a way to make
    // this shop's server send anybody a stream of reset emails.
    consume('forgot-password', callerKey(h), LOGIN_LIMIT)

    const { token } = await requestPasswordReset(body.email, {
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent'),
    })

    // Always the same response, whether or not the account exists.
    return {
      ok: true,
      message: 'If that email is registered, a reset link has been sent.',
      // Development convenience only - M13 replaces this with a real email.
      ...(process.env.NODE_ENV !== 'production' && token ? { devToken: token } : {}),
    }
  },
)
