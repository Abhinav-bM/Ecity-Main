import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { globalSearch } from '@/server/services/search.service'
import { deviceTimeline } from '@/server/services/device-history.service'
import { dashboard } from '@/server/services/dashboard.service'
import { salesTotals, salesByDay } from '@/server/services/analytics.service'
import { shopDateString } from '@/lib/date'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * The PRD §9.1 targets, measured on §9.1-sized data (M14).
 *
 * Skipped unless PERF_DB names a database seeded by scripts/perf-seed.sql —
 * 250k devices, ~1M events, 900k sales. Timing anything on a developer's
 * near-empty database proves nothing; the queries that fall over at scale are
 * exactly the ones that look instant on three thousand rows.
 *
 *   PERF_DB=postgres://ecity:ecity@localhost:5432/ecity_perf \\
 *     npx vitest run tests/integration/perf.integration.test.ts
 */
const perfUrl = process.env.PERF_DB
const suite = perfUrl ? describe : describe.skip

/** Measure the slowest of a few runs, not the fastest: the shop feels the worst one. */
async function slowest(times: number, fn: () => Promise<unknown>): Promise<number> {
  let worst = 0
  for (let i = 0; i < times; i += 1) {
    const started = performance.now()
    await fn()
    worst = Math.max(worst, performance.now() - started)
  }
  return Math.round(worst)
}

suite('PRD §9.1 performance targets on full-size data', () => {
  const actor: AuthUser = {
    id: 1,
    businessId: 9000,
    name: 'Perf',
    email: 'perf@example.local',
    roleId: 0,
    permissions: new Set([
      'inventory.view',
      'inventory.view_cost',
      'sale.view',
      'customer.view',
      'supplier.view',
      'product.view',
      'analytics.view',
      'analytics.view_profit',
      'purchase.view',
      'customer_payment.view',
      'cash.view',
      'closing.view',
    ]),
    branchIds: [],
    canViewAllBranches: true,
  }

  it('the dataset really is full size', async () => {
    const rows = (await db.execute<{ n: string }>(sql`
      select count(*)::text as n from device_unit where business_id = 9000
    `)) as unknown as { n: string }[]
    expect(Number(rows[0]!.n)).toBeGreaterThan(200_000)
  })

  it('a full IMEI lookup answers in under 500 ms', async () => {
    const target = (await db.execute<{ primary_identifier: string }>(sql`
      select primary_identifier from device_unit where business_id = 9000 limit 1
    `)) as unknown as { primary_identifier: string }[]
    const imei = target[0]!.primary_identifier

    const ms = await slowest(3, () => globalSearch(actor, imei))
    expect(ms, `full IMEI lookup took ${ms}ms`).toBeLessThan(500)
  })

  it('a partial IMEI search answers in under 500 ms', async () => {
    // The one that needs the trigram index — a suffix cannot use a b-tree.
    const ms = await slowest(3, () => globalSearch(actor, '234567'))
    expect(ms, `partial IMEI search took ${ms}ms`).toBeLessThan(500)
  })

  it('a name search answers in under 500 ms', async () => {
    const ms = await slowest(3, () => globalSearch(actor, 'Perf Customer 12'))
    expect(ms, `name search took ${ms}ms`).toBeLessThan(500)
  })

  it('a device history page builds in under 1.5 s', async () => {
    const target = (await db.execute<{ id: string }>(sql`
      select d.id::text from device_unit d
      where d.business_id = 9000 and d.id % 4 = 0
      limit 1
    `)) as unknown as { id: string }[]

    const ms = await slowest(3, () => deviceTimeline(actor, Number(target[0]!.id)))
    expect(ms, `device history took ${ms}ms`).toBeLessThan(1500)
  })

  it('the dashboard builds in under 2 s', { timeout: 60_000 }, async () => {
    const ms = await slowest(2, () => dashboard(actor))
    expect(ms, `dashboard took ${ms}ms`).toBeLessThan(2000)
  })

  it('twelve months of analytics answers in under 5 s', { timeout: 60_000 }, async () => {
    const to = shopDateString()
    const from = shopDateString(new Date(Date.now() - 365 * 86_400_000))
    const range = { from, to }

    const ms = await slowest(2, async () => {
      await salesTotals(actor, range)
      await salesByDay(actor, range)
    })
    expect(ms, `twelve-month analytics took ${ms}ms`).toBeLessThan(5000)
  })
})
