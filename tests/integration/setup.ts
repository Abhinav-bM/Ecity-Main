import postgres from 'postgres'

/**
 * Integration tests need a real Postgres. They run in CI (which provides one)
 * and locally once `docker compose up -d` is running. When no database is
 * reachable they skip loudly rather than failing, so `npm test` stays useful
 * on a machine without Docker.
 */
export async function databaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url || url.includes('unused')) return false
  try {
    const sql = postgres(url, { max: 1, connect_timeout: 3 })
    await sql`select 1`
    await sql.end()
    return true
  } catch {
    return false
  }
}

import { db } from '@/server/db'

const APPEND_ONLY_TABLES = [
  'device_event',
  'stock_ledger',
  'supplier_ledger_entry',
  'customer_ledger_entry',
  'cash_movement',
  'account_transaction',
  'audit_log',
] as const

/**
 * Run teardown deletes with the append-only triggers suspended.
 *
 * Suspending them is global DDL, not per-connection, so integration test
 * files MUST NOT run in parallel - otherwise one file's teardown switches the
 * triggers off while another is asserting that they fire, and that assertion
 * silently passes. `fileParallelism: false` in vitest.config.ts is what makes
 * this safe; do not remove one without the other.
 *
 * Test teardown is the only legitimate reason to bypass these triggers.
 */
export async function withAppendOnlySuspended(fn: () => Promise<void>): Promise<void> {
  for (const t of APPEND_ONLY_TABLES) {
    await db.execute(`alter table ${t} disable trigger user`)
  }
  try {
    await fn()
  } finally {
    for (const t of APPEND_ONLY_TABLES) {
      await db.execute(`alter table ${t} enable trigger user`)
    }
  }
}

/**
 * Remove one tenant's customer-credit rows.
 *
 * The customer ledger has a foreign key to `customer` and an append-only
 * trigger, so a test that creates a credit sale cannot delete its customers
 * afterwards without clearing this first. Call inside withAppendOnlySuspended.
 */
export async function clearCustomerCredit(businessId: number) {
  await db.execute(`delete from customer_payment_allocation where payment_id in
    (select id from customer_payment where business_id = ${businessId})`)
  await db.execute(`delete from customer_payment where business_id = ${businessId}`)
  await db.execute(`delete from customer_ledger_entry where business_id = ${businessId}`)
}

/**
 * Remove one tenant's M7 money rows.
 *
 * `cash_drawer_day` and the two money ledgers hang off branch and business, so
 * a test that billed anything cannot drop its branches until these go. Both
 * ledgers are append-only, so this must run inside `withAppendOnlySuspended`.
 */
export async function clearMoney(businessId: number) {
  await db.execute(`delete from cash_movement where business_id = ${businessId}`)
  await db.execute(`delete from account_transaction where business_id = ${businessId}`)
  await db.execute(`delete from expense where business_id = ${businessId}`)
  await db.execute(`delete from daily_closing where business_id = ${businessId}`)
  await db.execute(`delete from cash_drawer_day where business_id = ${businessId}`)
  await db.execute(`delete from account where business_id = ${businessId}`)
}

/**
 * Assert that a database rule — a trigger or a check constraint — rejected
 * the write, whatever wrapped the error on the way out.
 *
 * Drizzle 0.45 wraps every driver error in one of its own, whose message is
 * "Failed query: …" with Postgres's actual complaint on `.cause`. A plain
 * `rejects.toThrow(/append-only/)` therefore passes on 0.38 and fails on
 * 0.45 while the trigger is working perfectly — which is the worst kind of
 * test, because the obvious reading of the failure is that the guard has
 * gone. This walks the cause chain, so the assertion says what it means:
 * *the database refused this*, not *the error text happened to be flat*.
 */
export async function expectDatabaseRefusal(
  promise: Promise<unknown>,
  reason: RegExp,
): Promise<void> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }

  if (thrown === undefined) {
    throw new Error(`Expected the database to refuse this (${reason}), but it went through.`)
  }

  const messages: string[] = []
  for (let e: unknown = thrown, depth = 0; e instanceof Error && depth < 5; depth += 1) {
    messages.push(e.message)
    e = (e as Error & { cause?: unknown }).cause
  }

  if (!messages.some((m) => reason.test(m))) {
    throw new Error(
      `Expected a refusal matching ${reason}, got:\n  ${messages.join('\n  ')}`,
    )
  }
}
