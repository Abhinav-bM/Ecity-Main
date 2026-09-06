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
