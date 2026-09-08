import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ALL_PERMISSIONS } from '@/lib/permissions'

/**
 * Every endpoint declares who may call it (PRD FR-32.2, M14 hardening).
 *
 * This is the most valuable test in the project, because the failure it
 * catches is invisible until it is embarrassing: one branch's staff reading
 * another branch's money. It is a *static* sweep on purpose — it enumerates
 * the route files on disk rather than a list somebody maintains, so an
 * endpoint added next year is covered the day it is written, whether or not
 * anyone remembers this file exists.
 *
 * It asserts three things about every handler:
 *   1. it goes through `route()`, which is where authentication lives;
 *   2. it names a permission, or is explicitly and namedly public;
 *   3. that permission is a real one.
 */

const API_ROOT = join(process.cwd(), 'src', 'app', 'api')

/**
 * Endpoints that are deliberately open, each with the reason.
 *
 * A public endpoint is a decision, so it is listed here by name rather than
 * inferred from a flag in the file — adding one means editing this list, and
 * that is the review the decision deserves.
 */
const PUBLIC = new Map<string, string>([
  ['auth/login/route.ts', 'Signing in cannot require being signed in.'],
  ['auth/logout/route.ts', 'Signing out must work even with a half-broken session.'],
  ['auth/forgot-password/route.ts', 'Requested by someone who cannot get in.'],
  ['auth/reset-password/route.ts', 'Authorised by the emailed token, not a session.'],
  ['health/route.ts', 'The uptime monitor and the deploy both need it unauthenticated.'],
])

/**
 * Signed in, but authorising themselves rather than with one blanket
 * permission. Each needs a reason, for the same review as PUBLIC.
 *
 * These are not holes — they are places where one permission would be either
 * too broad or too narrow, so the check moved closer to the data.
 */
const SELF_GUARDED = new Map<string, string>([
  [
    'search/route.ts',
    'Every branch of the search checks the permission for the kind of record it is about to return (docs/03 §4.11). One blanket permission would either lock out staff who legitimately search, or hand them rows they cannot open.',
  ],
  [
    'session/branch/route.ts',
    'Switching branch is not a permission but a scope check: it calls canAccessBranch on the branch asked for, which is the same check every query makes.',
  ],
  [
    'attachments/route.ts',
    'Listing is scoped to the caller’s business inside the service; uploading calls requirePermission("attachment.upload") directly, because a multipart body cannot go through the JSON wrapper.',
  ],
  [
    'files/route.ts',
    'A signed URL plus a session in the owning business — two independent checks, so a leaked link is useless to an outsider and to anyone in another shop.',
  ],
])

/**
 * Route files that re-export handlers built by a shared factory. The
 * permission is declared there, so that is where it is checked.
 */
const FACTORY = new Map<string, string>([
  ['customers/route.ts', 'src/server/party-routes.ts'],
  ['customers/[id]/route.ts', 'src/server/party-routes.ts'],
  ['customers/[id]/status/route.ts', 'src/server/party-routes.ts'],
  ['suppliers/route.ts', 'src/server/party-routes.ts'],
  ['suppliers/[id]/route.ts', 'src/server/party-routes.ts'],
  ['suppliers/[id]/status/route.ts', 'src/server/party-routes.ts'],
])

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const files = routeFiles(API_ROOT).map((f) => ({
  path: f,
  rel: relative(API_ROOT, f),
  source: readFileSync(f, 'utf8'),
}))

describe('every API endpoint', () => {
  it('finds them all, so this sweep cannot quietly shrink', () => {
    // A guard on the guard: if a refactor moved the routes, this fails rather
    // than passing an empty sweep.
    expect(files.length).toBeGreaterThan(60)
  })

  it('goes through route(), which is where authentication happens', () => {
    const bare = files
      // A public endpoint has no session to check, so it may be hand-written.
      .filter((f) => !PUBLIC.has(f.rel) && !SELF_GUARDED.has(f.rel) && !FACTORY.has(f.rel))
      .filter((f) => !/\broute\s*\(/.test(f.source))
    expect(bare.map((f) => f.rel)).toEqual([])
  })

  it('names a permission, or is a listed public endpoint', () => {
    const unguarded = files
      .filter((f) => !PUBLIC.has(f.rel) && !SELF_GUARDED.has(f.rel) && !FACTORY.has(f.rel))
      .filter((f) => !/permission:\s*'[a-z_]+\.[a-z_]+'/.test(f.source))
      .map((f) => f.rel)

    expect(
      unguarded,
      `these endpoints name no permission and are not listed as public:\n  ${unguarded.join('\n  ')}`,
    ).toEqual([])
  })

  it('uses permissions that actually exist', () => {
    const known = new Set<string>(ALL_PERMISSIONS)
    const unknown: string[] = []

    for (const file of files) {
      for (const match of file.source.matchAll(/permission:\s*'([a-z_]+\.[a-z_]+)'/g)) {
        if (!known.has(match[1]!)) unknown.push(`${file.rel} → ${match[1]}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('declares where the branch comes from, so scope is never accidental', () => {
    /*
     * `branchFrom` decides which branch the permission is checked against.
     * Leaving it off falls back to the session's active branch, which is
     * usually right and occasionally a hole — so it is required to be
     * explicit rather than defaulted into.
     */
    const implicit = files
      .filter((f) => !PUBLIC.has(f.rel) && !SELF_GUARDED.has(f.rel))
      .filter((f) => /permission:/.test(f.source))
      .filter((f) => !/branchFrom:\s*'(none|body|session)'/.test(f.source))
      .map((f) => f.rel)

    expect(
      implicit,
      `these endpoints do not say which branch to check against:\n  ${implicit.join('\n  ')}`,
    ).toEqual([])
  })

  it('has a reason recorded for every exemption, and no stale entries', () => {
    const paths = new Set(files.map((f) => f.rel))
    for (const list of [PUBLIC, SELF_GUARDED]) {
      const stale = [...list.keys()].filter((p) => !paths.has(p))
      expect(stale, 'exempted but no longer exists').toEqual([])
      for (const [path, reason] of list) {
        expect(reason.length, `${path} needs a reason`).toBeGreaterThan(20)
      }
    }
    const staleFactories = [...FACTORY.keys()].filter((p) => !paths.has(p))
    expect(staleFactories).toEqual([])
  })

  it('the shared factories really do declare permissions', () => {
    // Otherwise the FACTORY list above would be a way to opt out of the sweep.
    for (const factory of new Set(FACTORY.values())) {
      const source = readFileSync(join(process.cwd(), factory), 'utf8')
      expect(
        /permission:/.test(source),
        `${factory} builds route handlers but names no permission`,
      ).toBe(true)
    }
  })
})

/**
 * The destructive-path audit (PRD FR-31.2).
 *
 * Financial and inventory documents are never hard-deleted; they move to a
 * cancelled, voided, returned or reversed state. A DELETE handler on one of
 * those is the bug this catches — and it is the kind that gets added in a
 * hurry to "clean up a test record".
 */
describe('nothing destroys a financial or inventory record', () => {
  /*
   * Checked at the service layer, not by HTTP verb.
   *
   * The first version of this looked for `export const DELETE` and found
   * `expenses/[id]`, which is a DELETE that *voids* — a reasonable REST
   * choice and not a destructive path at all. The verb says nothing; what
   * matters is whether a row is actually removed.
   */
  const SERVICES = join(process.cwd(), 'src', 'server', 'services')

  /** Rows that must never be removed, only superseded by a new state. */
  const PROTECTED = [
    'sale',
    'saleItem',
    'salePayment',
    'purchase',
    'purchaseItem',
    'salesReturn',
    'returnItem',
    'refund',
    'tradeIn',
    'customerPayment',
    'customerLedgerEntry',
    'supplierPayment',
    'supplierLedgerEntry',
    'expense',
    'cashMovement',
    'cashDrawerDay',
    'dailyClosing',
    'accountTransaction',
    'deviceUnit',
    'deviceEvent',
    'deviceIdentifier',
    'stockLedger',
    'stockTransfer',
    'transferItem',
    'stockAdjustment',
    'auditLog',
  ]

  /**
   * The one allowed exception, with its reason.
   *
   * Reversing a purchase VOIDs its handsets — the unit and its whole event
   * history remain — but releases their IMEIs, so a corrected purchase can
   * book the same phones in again. `device_identifier` is a claim on a
   * number, not history; giving up the claim destroys nothing. Named here so
   * that a *different* delete of identifiers still fails this test.
   */
  const ALLOWED = new Set(['purchase.service.ts deletes deviceIdentifier'])

  it('no service deletes one', () => {
    const offenders: string[] = []

    for (const file of readdirSync(SERVICES)) {
      const source = readFileSync(join(SERVICES, file), 'utf8')
      for (const match of source.matchAll(/\.delete\(\s*([A-Za-z]+)\s*\)/g)) {
        const table = match[1]!
        const found = `${file} deletes ${table}`
        if (PROTECTED.includes(table) && !ALLOWED.has(found)) offenders.push(found)
      }
    }

    expect(
      offenders,
      `money and stock are voided or reversed, never removed:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('the few things that may be deleted are the ones that carry no history', () => {
    /*
     * A guard against the list above being quietly emptied: these two are the
     * only real deletes in the service layer, and both are fine — an
     * attachment is a file somebody added by mistake, and a saved report is a
     * bookmark. Neither is a financial record.
     */
    const allowed: string[] = []
    for (const file of readdirSync(SERVICES)) {
      const source = readFileSync(join(SERVICES, file), 'utf8')
      for (const match of source.matchAll(/db\.delete\(\s*([A-Za-z]+)\s*\)/g)) {
        allowed.push(`${file}:${match[1]}`)
      }
    }
    expect(allowed.sort()).toEqual([
      'attachment.service.ts:attachment',
      'saved-report.service.ts:savedReport',
    ])
  })
})
