import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { appUser, passwordResetToken, userBranch } from '@/server/db/schema'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { createSession, revokeAllSessionsForUser } from '@/server/auth/session'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError } from '@/server/http'
import { logger } from '@/server/logger'

const MAX_FAILED_LOGINS = 8
const LOCKOUT_MINUTES = 15
const RESET_TOKEN_MINUTES = 60

/** Deliberately identical for wrong email and wrong password. */
const INVALID_CREDENTIALS = 'Email or password is incorrect.'

export async function login(
  input: { email: string; password: string },
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ token: string; userId: number; mustChangePassword: boolean }> {
  const rows = await db.select().from(appUser).where(eq(appUser.email, input.email)).limit(1)
  const user = rows[0]

  if (!user) {
    // Spend comparable time so the response does not reveal whether the
    // account exists.
    await verifyPassword(input.password, 'scrypt$AAAA$AAAA')
    throw new AppError(INVALID_CREDENTIALS, 401, 'INVALID_CREDENTIALS')
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'Too many failed attempts. Try again in a few minutes.',
      429,
      'ACCOUNT_LOCKED',
    )
  }

  const ok = await verifyPassword(input.password, user.passwordHash)
  const auditCtx: AuditContext = {
    actor: { id: user.id, businessId: user.businessId, name: user.name },
    businessId: user.businessId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  }

  if (!ok) {
    const failed = user.failedLoginCount + 1
    await db
      .update(appUser)
      .set({
        failedLoginCount: failed,
        lockedUntil:
          failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      })
      .where(eq(appUser.id, user.id))
    await writeAudit(auditCtx, {
      action: 'LOGIN_FAILED',
      entityType: 'app_user',
      entityId: user.id,
      summary: `Failed sign-in attempt (${failed})`,
    })
    throw new AppError(INVALID_CREDENTIALS, 401, 'INVALID_CREDENTIALS')
  }

  if (!user.isActive) {
    throw new AppError('This account has been deactivated.', 403, 'ACCOUNT_INACTIVE')
  }

  // Default the active branch to the user's only branch, if they have exactly one.
  const branches = await db
    .select({ branchId: userBranch.branchId })
    .from(userBranch)
    .where(eq(userBranch.userId, user.id))
  const activeBranchId = branches.length === 1 ? branches[0]!.branchId : null

  const token = await createSession({
    userId: user.id,
    activeBranchId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  })

  await db
    .update(appUser)
    .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(appUser.id, user.id))

  await writeAudit(auditCtx, {
    action: 'LOGIN',
    entityType: 'app_user',
    entityId: user.id,
    summary: 'Signed in',
  })

  return { token, userId: user.id, mustChangePassword: user.mustChangePassword }
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/**
 * Always resolves, whether or not the address exists - otherwise this endpoint
 * becomes an account-enumeration oracle.
 */
export async function requestPasswordReset(
  email: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ token: string | null }> {
  const rows = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1)
  const user = rows[0]
  if (!user || !user.isActive) return { token: null }

  const token = randomBytes(32).toString('base64url')
  await db.insert(passwordResetToken).values({
    userId: user.id,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
  })

  await writeAudit(
    {
      actor: { id: user.id, businessId: user.businessId, name: user.name },
      businessId: user.businessId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
    {
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'app_user',
      entityId: user.id,
      summary: 'Password reset requested',
    },
  )

  // M13 replaces this with a real email. Until then the link is logged so
  // the flow is usable in development.
  logger.info({ userId: user.id }, 'Password reset token issued')
  return { token }
}

export async function resetPassword(
  input: { token: string; password: string },
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const tokenHash = hashResetToken(input.token)
  const rows = await db
    .select({ id: passwordResetToken.id, userId: passwordResetToken.userId })
    .from(passwordResetToken)
    .where(
      and(
        eq(passwordResetToken.tokenHash, tokenHash),
        isNull(passwordResetToken.usedAt),
        gt(passwordResetToken.expiresAt, new Date()),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) throw new AppError('This reset link is invalid or has expired.', 400, 'INVALID_TOKEN')

  const users = await db.select().from(appUser).where(eq(appUser.id, row.userId)).limit(1)
  const user = users[0]
  if (!user) throw new AppError('This reset link is invalid or has expired.', 400, 'INVALID_TOKEN')

  await db.transaction(async (tx) => {
    await tx
      .update(appUser)
      .set({
        passwordHash: await hashPassword(input.password),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(appUser.id, user.id))

    await tx
      .update(passwordResetToken)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetToken.id, row.id))

    // Invalidate any other outstanding tokens for this user.
    await tx
      .update(passwordResetToken)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetToken.userId, user.id), isNull(passwordResetToken.usedAt)))

    await writeAudit(
      {
        actor: { id: user.id, businessId: user.businessId, name: user.name },
        businessId: user.businessId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      {
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'app_user',
        entityId: user.id,
        summary: 'Password changed via reset link',
      },
      tx,
    )
  })

  // A password change ends every existing session.
  await revokeAllSessionsForUser(user.id)
}

export const _sql = sql
