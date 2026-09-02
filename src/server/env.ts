import { z } from 'zod'

/**
 * Fail fast on a misconfigured environment rather than at the first query.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** 32+ random bytes, base64. Used to sign/derive nothing yet but reserved. */
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_URL: z.string().url().optional(),
  /** Sliding session idle timeout, minutes. */
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(720),
  /** Absolute session lifetime, hours, regardless of activity. */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(24 * 14),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

let cached: z.infer<typeof schema> | null = null

export function env(): z.infer<typeof schema> {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`)
  }
  cached = parsed.data
  return cached
}
