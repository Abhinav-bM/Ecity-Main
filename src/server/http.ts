import { NextResponse } from 'next/server'
import { ZodError, type ZodTypeAny, type output as ZodOutput } from 'zod'
import { AuthorisationError, requirePermission, type AuthUser } from '@/server/auth/permissions'
import { getSessionContext, type SessionContext } from '@/server/auth/session'
import { logger } from '@/server/logger'
import type { PermissionCode } from '@/lib/permissions'

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'BAD_REQUEST',
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (what = 'Record') => new AppError(`${what} not found.`, 404, 'NOT_FOUND')
export const conflict = (message: string, details?: unknown) =>
  new AppError(message, 409, 'CONFLICT', details)

type Handler<T> = (args: {
  req: Request
  ctx: SessionContext
  user: AuthUser
  body: T
  params: Record<string, string>
}) => Promise<unknown>

type Options<S extends ZodTypeAny | undefined> = {
  /** Required permission. Omit only for genuinely public endpoints. */
  permission?: PermissionCode
  /** Where to read the branch id from for the scope check. */
  branchFrom?: 'session' | 'body' | 'none'
  schema?: S
  /** Set true for endpoints that must work without a session (login, reset). */
  public?: boolean
}

/** The parsed body type: the schema's *output*, so Zod defaults are applied. */
type BodyOf<S> = S extends ZodTypeAny ? ZodOutput<S> : undefined

/**
 * The one wrapper every route handler uses. It guarantees, in order:
 *   1. a session exists (unless public)
 *   2. the permission and branch scope are checked SERVER-SIDE
 *   3. the body is validated by Zod before any handler code runs
 *   4. errors become consistent JSON rather than stack traces
 *
 * docs/02 §2.2 rule 1.
 */
export function route<S extends ZodTypeAny | undefined = undefined>(
  options: Options<S>,
  handler: Handler<BodyOf<S>>,
) {
  return async (
    req: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const params = (await context?.params) ?? {}

      let body = undefined as BodyOf<S>
      if (options.schema) {
        let raw: unknown = {}
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          raw = await req.json().catch(() => ({}))
        } else {
          raw = Object.fromEntries(new URL(req.url).searchParams.entries())
        }
        body = options.schema.parse(raw) as BodyOf<S>
      }

      const session = await getSessionContext()
      if (!options.public && !session) {
        return NextResponse.json(
          { error: 'Not signed in.', code: 'UNAUTHENTICATED' },
          { status: 401 },
        )
      }

      if (options.permission) {
        const branchId =
          options.branchFrom === 'none'
            ? null
            : options.branchFrom === 'body'
              ? ((body as { branchId?: number } | undefined)?.branchId ?? null)
              : (session?.activeBranchId ?? null)
        requirePermission(session?.user ?? null, options.permission, branchId)
      }

      const result = await handler({
        req,
        ctx: session as SessionContext,
        user: (session?.user ?? null) as AuthUser,
        body,
        params,
      })

      if (result instanceof Response) return result
      return NextResponse.json(jsonSafe(result ?? { ok: true }))
    } catch (error) {
      return toResponse(error)
    }
  }
}

/**
 * Make a value safe for JSON.
 *
 * Money is bigint paise everywhere (docs/03 §4.1), and JSON.stringify throws
 * outright on a bigint - "Do not know how to serialize a BigInt". Every route
 * returning a row with money in it would 500, and only when something first
 * called it. Converting to a string here keeps the precision that made us
 * choose bigint in the first place; a number would not.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    )
  }
  return value
}

export function toResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Please check the highlighted fields.',
        code: 'VALIDATION_ERROR',
        fieldErrors: error.flatten().fieldErrors,
      },
      { status: 422 },
    )
  }
  if (error instanceof AuthorisationError) {
    return NextResponse.json({ error: error.message, code: 'FORBIDDEN' }, { status: 403 })
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    )
  }
  logger.error({ err: error }, 'Unhandled error in route handler')
  return NextResponse.json(
    { error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' },
    { status: 500 },
  )
}
