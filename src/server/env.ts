import { z } from 'zod'

/**
 * Fail fast on a misconfigured environment rather than at the first query.
 */
/**
 * An empty variable means "not set".
 *
 * `.env` files are written by hand, and `S3_BUCKET=` with nothing after it is
 * how people leave a placeholder. Left as a plain optional string that fails
 * `.min(1)`, it takes the whole application down at startup with a schema
 * error, rather than reaching the code that knows what the variable is for
 * and can say so.
 */
const optionalEnv = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
)

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
  /** Where uploaded files live. 'local' writes to .storage/ - development only. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),

  /*
   * Object storage, when STORAGE_DRIVER is 's3'.
   *
   * "S3" is the protocol, not the company: Cloudflare R2 speaks it, which is
   * what this shop uses (no egress charges, 10 GB free). Backblaze B2 or
   * MinIO would work by changing the endpoint alone.
   *
   * Optional here rather than required, because a developer running with the
   * local driver should not have to invent four values. `s3Config()` in
   * storage/ refuses at startup if the driver is 's3' and any are missing —
   * a clear failure beats writing a shop's bill photos into a container that
   * is about to be replaced.
   */
  S3_ENDPOINT: optionalEnv,
  S3_BUCKET: optionalEnv,
  S3_ACCESS_KEY_ID: optionalEnv,
  S3_SECRET_ACCESS_KEY: optionalEnv,
  /** Cloudflare's account id, if you would rather not write the endpoint out. */
  R2_ACCOUNT_ID: optionalEnv,
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
