import { sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { exportJob } from '@/server/db/schema'
import { AppError } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * The owner's own copy of everything (PRD FR-32.3).
 *
 * Distinct from the reports in M11, which answer questions. This answers a
 * different one: *if this software went away tomorrow, what would I still
 * have?* So it is deliberately dumb and complete — every table, every row,
 * as it stands, in a format anything can read. Nothing is summarised,
 * because a summary is exactly what you cannot rebuild from.
 *
 * It is not a database backup and does not replace one (docs/04 §7): no
 * schema, no constraints, no triggers. A backup is for restoring the system;
 * this is for the owner leaving with their data.
 */

/**
 * What goes in, in an order a person can follow: what the shop is, what it
 * sells, who it trades with, then what happened.
 *
 * An explicit list rather than "every table": `session`, `password_reset`
 * and the import staging tables are either secrets or scaffolding, and a
 * blanket dump would hand out password-reset tokens with the sales figures.
 */
const TABLES: { table: string; label: string }[] = [
  { table: 'business', label: 'Business' },
  { table: 'branch', label: 'Branches' },
  { table: 'app_user', label: 'Users' },
  { table: 'role', label: 'Roles' },
  { table: 'brand', label: 'Brands' },
  { table: 'category', label: 'Categories' },
  { table: 'product', label: 'Products' },
  { table: 'tax_rate', label: 'Tax rates' },
  { table: 'payment_method', label: 'Payment methods' },
  { table: 'customer', label: 'Customers' },
  { table: 'supplier', label: 'Suppliers' },
  { table: 'device_unit', label: 'Devices' },
  { table: 'device_identifier', label: 'Device identifiers' },
  { table: 'device_event', label: 'Device history' },
  { table: 'branch_stock', label: 'Stock on hand' },
  { table: 'stock_ledger', label: 'Stock movements' },
  { table: 'purchase', label: 'Purchases' },
  { table: 'purchase_item', label: 'Purchase lines' },
  { table: 'sale', label: 'Sales' },
  { table: 'sale_item', label: 'Sale lines' },
  { table: 'sale_payment', label: 'Sale payments' },
  { table: 'sales_return', label: 'Returns' },
  { table: 'trade_in', label: 'Trade-ins' },
  { table: 'customer_payment', label: 'Customer payments' },
  { table: 'customer_ledger_entry', label: 'Customer ledger' },
  { table: 'supplier_payment', label: 'Supplier payments' },
  { table: 'supplier_ledger_entry', label: 'Supplier ledger' },
  { table: 'expense', label: 'Expenses' },
  { table: 'expense_category', label: 'Expense categories' },
  { table: 'account', label: 'Accounts' },
  { table: 'account_transaction', label: 'Account transactions' },
  { table: 'cash_drawer_day', label: 'Cash drawer days' },
  { table: 'cash_movement', label: 'Cash movements' },
  { table: 'daily_closing', label: 'Daily closings' },
  { table: 'stock_transfer', label: 'Transfers' },
  { table: 'transfer_item', label: 'Transfer lines' },
  { table: 'stock_adjustment', label: 'Stock adjustments' },
  { table: 'audit_log', label: 'Audit log' },
]

/** Columns never handed out, whatever table they turn up in. */
const SECRETS = new Set(['password_hash', 'reset_token', 'token', 'session_token'])

export type BusinessExportManifest = {
  generatedAt: string
  business: string
  tables: { label: string; table: string; rows: number }[]
  totalRows: number
}

/** What the export will contain, for the screen to show before it is taken. */
export async function businessExportSummary(actor: AuthUser): Promise<BusinessExportManifest> {
  const tables: BusinessExportManifest['tables'] = []
  let totalRows = 0

  for (const entry of TABLES) {
    const rows = await countRows(actor, entry)
    tables.push({ label: entry.label, table: entry.table, rows })
    totalRows += rows
  }

  const name = (
    await db.execute<{ name: string }>(
      sql`select name from business where id = ${actor.businessId}`,
    )
  )[0] as { name: string } | undefined

  return {
    generatedAt: new Date().toISOString(),
    business: name?.name ?? 'This business',
    tables,
    totalRows,
  }
}

/**
 * Which tables carry `business_id`, asked of the database rather than kept by
 * hand in this file.
 *
 * A hand-kept flag was wrong within minutes — `device_event` has no
 * `business_id`, and the export died on it. Worse, a flag that said "scoped"
 * for a table that is not would filter on a column that does not exist (a
 * loud failure), while one that said "not scoped" for a table that is would
 * export every tenant's rows (a silent leak). The schema already knows;
 * asking it cannot drift.
 */
let tenantColumns: Set<string> | null = null

async function hasBusinessId(table: string): Promise<boolean> {
  if (!tenantColumns) {
    const rows = (await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'business_id'
    `)) as unknown as { table_name: string }[]
    tenantColumns = new Set(rows.map((r) => r.table_name))
  }
  return tenantColumns.has(table)
}

async function countRows(actor: AuthUser, entry: { table: string }): Promise<number> {
  const where = await whereFor(actor, entry)
  const rows = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from ${sql.raw(`"${entry.table}"`)} t where ${where}`,
  )
  return Number((rows as unknown as { n: string }[])[0]?.n ?? 0)
}

/**
 * One tenant's rows only.
 *
 * Tables that carry `business_id` filter on it directly. The ones that do not
 * are children — a sale line belongs to a sale — so they are reached through
 * their parent rather than exported whole. Getting this wrong would hand one
 * shop another's data, which is the single worst bug this feature could have.
 */
async function whereFor(actor: AuthUser, entry: { table: string }) {
  if (entry.table === 'business') return sql`t.id = ${actor.businessId}`
  if (await hasBusinessId(entry.table)) return sql`t.business_id = ${actor.businessId}`

  // A child row belongs to its parent's business. Reached through the parent
  // rather than exported whole, because these tables have no tenant of their
  // own to filter on.
  const parent: Record<string, string> = {
    device_identifier: 'select id from device_unit where business_id',
    device_event: 'select id from device_unit where business_id',
    branch_stock: 'select id from product where business_id',
    purchase_item: 'select id from purchase where business_id',
    sale_item: 'select id from sale where business_id',
    sale_payment: 'select id from sale where business_id',
    transfer_item: 'select id from stock_transfer where business_id',
  }
  const column: Record<string, string> = {
    device_identifier: 'device_id',
    device_event: 'device_id',
    branch_stock: 'product_id',
    purchase_item: 'purchase_id',
    sale_item: 'sale_id',
    sale_payment: 'sale_id',
    transfer_item: 'transfer_id',
  }

  const select = parent[entry.table]
  if (!select) {
    // Refuse rather than guess: an unfiltered export is a tenant leak.
    throw new AppError(
      `No tenant filter defined for ${entry.table}.`,
      500,
      'EXPORT_SCOPE_MISSING',
    )
  }
  return sql`t.${sql.raw(column[entry.table]!)} in (${sql.raw(select)} = ${actor.businessId})`
}

/**
 * The whole business as one CSV bundle, streamed.
 *
 * Streamed rather than assembled: a shop with five years of history has
 * millions of device events, and building that in memory to hand over one
 * file is how a small server falls over. Each table is announced, then its
 * rows follow — a single readable file rather than a zip a phone cannot open.
 */
export async function streamBusinessExport(actor: AuthUser): Promise<Response> {
  const summary = await businessExportSummary(actor)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text))

      // A byte-order mark, so Excel opens it as UTF-8 rather than mangling
      // every name with an accent (the same reason M11's exports carry one).
      write('﻿')
      write(`# ${summary.business} — complete data export\n`)
      write(`# Taken ${summary.generatedAt}\n`)
      write('# One section per table. This is your data, not a system backup:\n')
      write('# restoring the software needs a database backup (docs/04 §7).\n\n')

      for (const entry of TABLES) {
        try {
          const rows = (await db.execute(
            sql`select * from ${sql.raw(`"${entry.table}"`)} t where ${await whereFor(actor, entry)}`,
          )) as unknown as Record<string, unknown>[]

          write(`## ${entry.label} (${entry.table}) — ${rows.length} rows\n`)
          if (rows.length === 0) {
            write('\n')
            continue
          }

          const columns = Object.keys(rows[0]!).filter((c) => !SECRETS.has(c))
          write(columns.join(',') + '\n')
          for (const row of rows) {
            write(columns.map((c) => csvCell(row[c])).join(',') + '\n')
          }
          write('\n')
        } catch (error) {
          /*
           * One table failing must not cost the owner the other thirty-seven.
           * The section says so in the file itself rather than the download
           * simply stopping, which would look like the end of the data.
           */
          write(`## ${entry.label} (${entry.table}) — COULD NOT BE EXPORTED\n`)
          write(`# ${error instanceof Error ? error.message : 'unknown error'}\n\n`)
        }
      }

      controller.close()
    },
  })

  /*
   * Recorded where M11's exports are recorded, not in the audit log: this is
   * an export, and `export_job` is the history FR-32.1 asks to be visible.
   * Written before the stream is consumed, so a download somebody cancels
   * halfway still shows that a full copy of the business was taken.
   */
  await db.insert(exportJob).values({
    businessId: actor.businessId,
    report: 'business-full-export',
    format: 'csv',
    rowCount: summary.totalRows,
    createdBy: actor.id,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ecity-full-export-${stamp}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
