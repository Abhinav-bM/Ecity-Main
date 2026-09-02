import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import * as svc from '@/server/services/auth.service'
import { purgeExpiredSessions } from '@/server/auth/session'
import { effectivePermissionsInBranch } from '@/server/auth/permissions'
import { hashPassword } from '@/server/auth/password'
import { databaseAvailable } from './setup'

// Importing the db client does not open a connection - it is lazy
// (src/server/db/index.ts), which is what lets this file be imported at all
// on a machine with no database.

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

if (!available) {
  console.warn(
    '\n[integration] Skipped: no database reachable at DATABASE_URL.\n' +
      '              Run `docker compose up -d && npm run db:migrate` first.\n',
  )
}

suite('auth (database-backed)', () => {
  let businessId: number
  let roleId: number
  let branchA: number
  let branchB: number
  let userId: number

  const email = `itest-${Date.now()}@example.local`
  const password = 'integration-test-password'

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: 'Integration Co' }).returning()
    )[0]!.id

    roleId = (
      await db
        .insert(schema.role)
        .values({ businessId, code: `R${Date.now()}`, name: 'Test Role' })
        .returning()
    )[0]!.id

    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `A${Date.now()}`, name: 'Branch A' })
        .returning()
    )[0]!.id
    branchB = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `B${Date.now()}`, name: 'Branch B' })
        .returning()
    )[0]!.id

    userId = (
      await db
        .insert(schema.appUser)
        .values({
          businessId,
          name: 'Integration User',
          email,
          passwordHash: await hashPassword(password),
          roleId,
        })
        .returning()
    )[0]!.id

    await db.insert(schema.userBranch).values({ userId, branchId: branchA })
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(schema.appUser).where(eq(schema.appUser.id, userId))
    await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
    await db.delete(schema.role).where(eq(schema.role.id, roleId))
    await db.delete(schema.business).where(eq(schema.business.id, businessId))
  })

  it('signs in with the right password and records an audit row', async () => {
    const result = await svc.login({ email, password }, {})
    expect(result.userId).toBe(userId)
    expect(result.token).toMatch(/^[\w-]{20,}$/)

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.actorUserId, userId), eq(schema.auditLog.action, 'LOGIN')),
      )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('rejects a wrong password and audits the failure', async () => {
    await expect(svc.login({ email, password: 'wrong-password-here' }, {})).rejects.toThrow(
      /incorrect/i,
    )
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, userId),
          eq(schema.auditLog.action, 'LOGIN_FAILED'),
        ),
      )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('gives the same message for an unknown email as for a wrong password', async () => {
    await expect(
      svc.login({ email: 'nobody@example.local', password: 'whatever-long' }, {}),
    ).rejects.toThrow(/incorrect/i)
  })

  it('stores only a hash of the session token, never the token itself', async () => {
    const { token } = await svc.login({ email, password }, {})
    const stored = await db
      .select({ hash: schema.session.tokenHash })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
    expect(stored.every((s) => s.hash !== token)).toBe(true)
  })

  it('revokes every session when the password is reset', async () => {
    await svc.login({ email, password }, {})
    const { token } = await svc.requestPasswordReset(email, {})
    expect(token).toBeTruthy()

    await svc.resetPassword({ token: token!, password: 'a-brand-new-password' }, {})

    const live = await db
      .select()
      .from(schema.session)
      .where(and(eq(schema.session.userId, userId), sql`${schema.session.revokedAt} is null`))
    expect(live).toHaveLength(0)

    // The old password no longer works; the new one does.
    await expect(svc.login({ email, password }, {})).rejects.toThrow()
    await expect(
      svc.login({ email, password: 'a-brand-new-password' }, {}),
    ).resolves.toBeTruthy()
  })

  it('will not reuse a password reset token', async () => {
    const { token } = await svc.requestPasswordReset(email, {})
    await svc.resetPassword({ token: token!, password: 'yet-another-password' }, {})
    await expect(
      svc.resetPassword({ token: token!, password: 'third-password-here' }, {}),
    ).rejects.toThrow(/invalid or has expired/i)
  })

  it('refuses to update the append-only audit log', async () => {
    const row = (
      await db
        .insert(schema.auditLog)
        .values({
          businessId,
          action: 'CREATE',
          entityType: 'test',
          entityId: 'append-only-check',
        })
        .returning()
    )[0]!

    await expect(
      db.update(schema.auditLog).set({ summary: 'tampered' }).where(eq(schema.auditLog.id, row.id)),
    ).rejects.toThrow(/append-only/i)

    await expect(
      db.delete(schema.auditLog).where(eq(schema.auditLog.id, row.id)),
    ).rejects.toThrow(/append-only/i)
  })

  it('scopes a branch-limited user to their own branch only', async () => {
    // The user is assigned to branch A only.
    const assigned = await db
      .select({ branchId: schema.userBranch.branchId })
      .from(schema.userBranch)
      .where(eq(schema.userBranch.userId, userId))
    expect(assigned.map((a) => a.branchId)).toEqual([branchA])
    expect(assigned.map((a) => a.branchId)).not.toContain(branchB)

    // And resolving permissions in a branch does not widen them.
    const perms = await effectivePermissionsInBranch(userId, roleId, branchA)
    expect(perms.size).toBe(0)
  })

  it('purges sessions that are long expired', async () => {
    await expect(purgeExpiredSessions()).resolves.toBeTypeOf('number')
  })
})
