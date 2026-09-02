import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { appUser, branch, session, userBranch } from '@/server/db/schema'
import { env } from '@/server/env'
import { permissionsForRole, type AuthUser } from './permissions'
import type { PermissionCode } from '@/lib/permissions'

export const SESSION_COOKIE = 'ecity_session'

/**
 * Auth note (deviation from docs/03 §2, recorded deliberately):
 *
 * Auth.js v5's Credentials provider only supports JWT sessions - database
 * sessions are not available with it. The PRD requires server-side, revocable
 * sessions (FR-1.1, NFR §9.4), so this module implements them directly:
 * a random 32-byte token in an httpOnly cookie, with only its SHA-256 hash
 * stored. ~150 lines, no library to fight, and revocation actually works.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export type SessionContext = {
  user: AuthUser
  sessionId: number
  /** null means "all branches" for a user permitted to see them. */
  activeBranchId: number | null
}

export async function createSession(opts: {
  userId: number
  activeBranchId: number | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<string> {
  const token = newToken()
  const now = Date.now()
  await db.insert(session).values({
    userId: opts.userId,
    tokenHash: hashToken(token),
    activeBranchId: opts.activeBranchId,
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
    expiresAt: new Date(now + env().SESSION_IDLE_MINUTES * 60_000),
    absoluteExpiresAt: new Date(now + env().SESSION_ABSOLUTE_HOURS * 3_600_000),
  })
  return token
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: env().SESSION_IDLE_MINUTES * 60,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Resolve the current request's session, or null.
 * Slides the idle expiry forward, capped by absoluteExpiresAt.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const tokenHash = hashToken(token)
  const rows = await db
    .select({
      sessionId: session.id,
      activeBranchId: session.activeBranchId,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: session.revokedAt,
      storedHash: session.tokenHash,
      userId: appUser.id,
      businessId: appUser.businessId,
      name: appUser.name,
      email: appUser.email,
      roleId: appUser.roleId,
      isActive: appUser.isActive,
    })
    .from(session)
    .innerJoin(appUser, eq(appUser.id, session.userId))
    .where(eq(session.tokenHash, tokenHash))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // Constant-time compare even though the lookup was by hash.
  const a = Buffer.from(row.storedHash)
  const b = Buffer.from(tokenHash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const now = new Date()
  if (row.revokedAt) return null
  if (row.expiresAt <= now || row.absoluteExpiresAt <= now) return null
  if (!row.isActive) return null

  const permissions = await permissionsForRole(row.roleId)
  const canViewAllBranches = permissions.has('branch.view_all' as PermissionCode)
  const branchIds = canViewAllBranches
    ? await allBranchIds(row.businessId)
    : await assignedBranchIds(row.userId)

  // Slide the idle window forward, but never past the absolute cap.
  const nextExpiry = new Date(
    Math.min(now.getTime() + env().SESSION_IDLE_MINUTES * 60_000, row.absoluteExpiresAt.getTime()),
  )
  await db
    .update(session)
    .set({ lastSeenAt: now, expiresAt: nextExpiry })
    .where(eq(session.id, row.sessionId))

  return {
    sessionId: row.sessionId,
    activeBranchId: row.activeBranchId,
    user: {
      id: row.userId,
      businessId: row.businessId,
      name: row.name,
      email: row.email,
      roleId: row.roleId,
      permissions,
      branchIds,
      canViewAllBranches,
    },
  }
}

async function assignedBranchIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ branchId: userBranch.branchId })
    .from(userBranch)
    .innerJoin(branch, eq(branch.id, userBranch.branchId))
    .where(and(eq(userBranch.userId, userId), eq(branch.status, 'ACTIVE')))
  return rows.map((r) => r.branchId)
}

async function allBranchIds(businessId: number): Promise<number[]> {
  const rows = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.businessId, businessId), eq(branch.status, 'ACTIVE')))
  return rows.map((r) => r.id)
}

export async function setActiveBranch(sessionId: number, branchId: number | null): Promise<void> {
  await db.update(session).set({ activeBranchId: branchId }).where(eq(session.id, sessionId))
}

export async function revokeSession(sessionId: number): Promise<void> {
  await db.update(session).set({ revokedAt: new Date() }).where(eq(session.id, sessionId))
}

/** Used when a password changes or a user is deactivated. */
export async function revokeAllSessionsForUser(userId: number): Promise<void> {
  await db
    .update(session)
    .set({ revokedAt: new Date() })
    .where(and(eq(session.userId, userId), isNull(session.revokedAt)))
}

/** Housekeeping, called by the worker. Keeps the table from growing forever. */
export async function purgeExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000)
  const result = await db
    .delete(session)
    .where(or(lt(session.absoluteExpiresAt, cutoff), lt(session.revokedAt, cutoff)))
  return (result as unknown as { count?: number }).count ?? 0
}

export const _internal = { hashToken, newToken, sql }
