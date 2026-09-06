import { and, asc, desc, eq, gte, isNull, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branch,
  customer,
  customerLedgerEntry,
  customerPayment,
  customerPaymentAllocation,
  paymentMethod,
  sale,
  salePayment,
} from '@/server/db/schema'
import { branchScope, type AuthUser } from '@/server/auth/permissions'

/**
 * What customers owe the shop (PRD FR-7.1 – FR-7.6).
 *
 * The balance is ALWAYS the sum of the append-only ledger, never a stored
 * counter (docs/03 §4.2). Positive means the customer owes money; negative
 * means they are in credit, which happens when a payment is more than the
 * bills it was allocated against.
 */

export async function postCustomerLedgerEntry(
  tx: DbOrTx,
  input: {
    businessId: number
    customerId: number
    branchId?: number | null
    entryType: (typeof customerLedgerEntry.$inferInsert)['entryType']
    amountPaise: bigint
    refType?: string
    refId?: number
    note?: string | null
    actorId?: number | null
    occurredAt?: Date
  },
): Promise<void> {
  await tx.insert(customerLedgerEntry).values({
    businessId: input.businessId,
    customerId: input.customerId,
    branchId: input.branchId ?? null,
    entryType: input.entryType,
    amountPaise: input.amountPaise,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
    actorId: input.actorId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  })
}

export async function customerBalance(customerId: number, tx: DbOrTx = db): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(${customerLedgerEntry.amountPaise}), 0)` })
    .from(customerLedgerEntry)
    .where(eq(customerLedgerEntry.customerId, customerId))
  return BigInt(rows[0]?.total ?? '0')
}

/* --------------------------------------------------------------- aging --- */

export const AGING_BUCKETS = ['0-7', '8-30', '31-60', '60+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

/**
 * Which aging bucket a debt falls in, by days outstanding.
 *
 * Counted from the due date where one was agreed, otherwise from the sale
 * date - a bill with no agreed date is already due. Boundaries follow the
 * module spec exactly: 0–7, 8–30, 31–60, 60+.
 */
export function agingBucket(daysOutstanding: number): AgingBucket {
  if (daysOutstanding <= 7) return '0-7'
  if (daysOutstanding <= 30) return '8-30'
  if (daysOutstanding <= 60) return '31-60'
  return '60+'
}

/** Whole days between two instants, floored, never negative. */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  if (ms <= 0) return 0
  return Math.floor(ms / 86_400_000)
}

export function emptyBuckets(): Record<AgingBucket, bigint> {
  return { '0-7': 0n, '8-30': 0n, '31-60': 0n, '60+': 0n }
}

/* ------------------------------------------------------ what a sale owes --- */

/**
 * Everything received against one sale: taken at the counter when the bill
 * was made, plus every later collection allocated to it.
 *
 * There is one definition because four screens ask the question, and a second
 * copy would eventually drift and show a settled bill as still owing.
 */
export function saleReceivedSql() {
  /*
   * "sale"."id" is written out rather than interpolated from the column.
   * Drizzle renders an un-joined column as a bare "id", and inside these
   * subqueries a bare "id" binds to customer_payment's own id instead - so a
   * caller with no join silently got the wrong number rather than an error.
   */
  return sql<string>`(
    coalesce((select sum(sp.amount_paise) from sale_payment sp
              where sp.sale_id = "sale"."id"), 0)
    + coalesce((select sum(cpa.amount_paise) from customer_payment_allocation cpa
                join customer_payment cp on cp.id = cpa.payment_id
                where cpa.sale_id = "sale"."id" and cp.voided_at is null), 0)
  )`
}

export async function saleReceivedPaise(saleId: number, tx: DbOrTx = db): Promise<bigint> {
  const counter = await tx
    .select({ total: sql<string>`coalesce(sum(${salePayment.amountPaise}), 0)` })
    .from(salePayment)
    .where(eq(salePayment.saleId, saleId))

  const later = await tx
    .select({ total: sql<string>`coalesce(sum(${customerPaymentAllocation.amountPaise}), 0)` })
    .from(customerPaymentAllocation)
    .innerJoin(customerPayment, eq(customerPayment.id, customerPaymentAllocation.paymentId))
    .where(
      and(
        eq(customerPaymentAllocation.saleId, saleId),
        // A voided receipt settles nothing.
        isNull(customerPayment.voidedAt),
      ),
    )

  return BigInt(counter[0]?.total ?? '0') + BigInt(later[0]?.total ?? '0')
}

/* ------------------------------------------------------------ the dues --- */

export type CustomerDue = {
  customerId: number
  customerName: string
  phone: string | null
  balancePaise: bigint
  /** Aged by invoice, so one customer can sit in several buckets. */
  buckets: Record<AgingBucket, bigint>
  oldestDueDate: Date | null
  overduePaise: bigint
  openInvoiceCount: number
}

export type DuesFilters = {
  branchId?: number | null
  /** Only customers with something past its due date. */
  overdueOnly?: boolean
  search?: string
  page?: number
  pageSize?: number
}

/**
 * PRD FR-7.6 — customer-wise outstanding with aging.
 *
 * Aged per invoice rather than per customer: a customer with one old bill and
 * one new one belongs in two buckets, and collapsing them to a single "oldest"
 * age would overstate how bad the debt is.
 */
export async function customerDues(
  actor: AuthUser,
  filters: DuesFilters = {},
  now: Date = new Date(),
): Promise<{
  rows: CustomerDue[]
  totals: Record<AgingBucket, bigint>
  totalPaise: bigint
  total: number
  page: number
  pageSize: number
}> {
  const conditions: SQL[] = [
    eq(sale.businessId, actor.businessId),
    isNotNull(sale.customerId),
    // A voided bill is not a debt.
    eq(sale.status, 'COMPLETED'),
  ]

  // branchScope returns [requested] after checking access, or the user's own
  // branches, or null for someone who may see everything.
  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${sale.branchId} in ${scope.length ? scope : [-1]}`)
  }

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(sql`(${customer.name} ilike ${term} or ${customer.phone} ilike ${term})`)
  }

  const rows = await db
    .select({
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      saleId: sale.id,
      soldAt: sale.soldAt,
      dueDate: sale.dueDate,
      totalPaise: sale.totalPaise,
      receivedPaise: saleReceivedSql(),
    })
    .from(sale)
    .innerJoin(customer, eq(customer.id, sale.customerId))
    .where(and(...conditions))
    .orderBy(asc(sale.soldAt))

  const byCustomer = new Map<number, CustomerDue>()

  for (const r of rows) {
    const owing = r.totalPaise - BigInt(r.receivedPaise)
    if (owing <= 0n) continue

    const entry =
      byCustomer.get(r.customerId) ??
      ({
        customerId: r.customerId,
        customerName: r.customerName,
        phone: r.phone,
        balancePaise: 0n,
        buckets: emptyBuckets(),
        oldestDueDate: null,
        overduePaise: 0n,
        openInvoiceCount: 0,
      } satisfies CustomerDue)

    // No agreed date means the money was due when the goods left the shop.
    const from = r.dueDate ?? r.soldAt
    const days = daysBetween(from, now)
    entry.balancePaise += owing
    entry.buckets[agingBucket(days)] += owing
    entry.openInvoiceCount += 1
    if (r.dueDate && r.dueDate.getTime() < now.getTime()) entry.overduePaise += owing
    if (!entry.oldestDueDate || from < entry.oldestDueDate) entry.oldestDueDate = from

    byCustomer.set(r.customerId, entry)
  }

  let result = [...byCustomer.values()]
  if (filters.overdueOnly) result = result.filter((r) => r.overduePaise > 0n)
  result.sort((a, b) => Number(b.balancePaise - a.balancePaise))

  /*
   * Totals are summed over EVERY debtor, then the rows are paged. The figure
   * at the top of the screen has to be what the shop is owed in total - not
   * the total of whichever 25 customers happen to be on this page.
   */
  const totals = emptyBuckets()
  let totalPaise = 0n
  for (const r of result) {
    totalPaise += r.balancePaise
    for (const b of AGING_BUCKETS) totals[b] += r.buckets[b]
  }

  /*
   * Paged in memory rather than in SQL. The aggregation is per-customer over
   * per-invoice rows, which SQL pagination would have to reproduce; the query
   * is already bounded by open invoices only, and rendering hundreds of rows
   * was the actual problem. Revisit if a shop ever carries enough open
   * invoices for the query itself to hurt.
   */
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.max(1, filters.pageSize ?? 25)
  const start = (page - 1) * pageSize

  return {
    rows: result.slice(start, start + pageSize),
    totals,
    totalPaise,
    total: result.length,
    page,
    pageSize,
  }
}

/* ------------------------------------------------------- the statement --- */

/**
 * PRD FR-7.6 — one customer's account, oldest first, with a running balance.
 *
 * A statement is something the shop hands to a customer who disputes what they
 * owe, so it shows every movement rather than a summary.
 */
export async function customerStatement(actor: AuthUser, customerId: number) {
  const entries = await db
    .select({
      id: customerLedgerEntry.id,
      entryType: customerLedgerEntry.entryType,
      amountPaise: customerLedgerEntry.amountPaise,
      note: customerLedgerEntry.note,
      refType: customerLedgerEntry.refType,
      refId: customerLedgerEntry.refId,
      occurredAt: customerLedgerEntry.occurredAt,
      branchName: branch.name,
    })
    .from(customerLedgerEntry)
    .leftJoin(branch, eq(branch.id, customerLedgerEntry.branchId))
    .where(
      and(
        eq(customerLedgerEntry.customerId, customerId),
        eq(customerLedgerEntry.businessId, actor.businessId),
      ),
    )
    .orderBy(asc(customerLedgerEntry.occurredAt), asc(customerLedgerEntry.id))

  let running = 0n
  const lines = entries.map((e) => {
    running += e.amountPaise
    return { ...e, balancePaise: running }
  })

  return { lines, closingBalancePaise: running }
}

/** Receipts collected from one customer, newest first (PRD FR-7.3). */
export async function customerReceipts(actor: AuthUser, customerId: number) {
  return db
    .select({
      id: customerPayment.id,
      receiptNumber: customerPayment.receiptNumber,
      amountPaise: customerPayment.amountPaise,
      receivedOn: customerPayment.receivedOn,
      reference: customerPayment.reference,
      voidedAt: customerPayment.voidedAt,
      voidReason: customerPayment.voidReason,
      methodName: paymentMethod.name,
      branchName: branch.name,
    })
    .from(customerPayment)
    .innerJoin(paymentMethod, eq(paymentMethod.id, customerPayment.paymentMethodId))
    .innerJoin(branch, eq(branch.id, customerPayment.branchId))
    .where(
      and(
        eq(customerPayment.customerId, customerId),
        eq(customerPayment.businessId, actor.businessId),
      ),
    )
    .orderBy(desc(customerPayment.receivedOn), desc(customerPayment.id))
    .limit(200)
}


/* ------------------------------------------------------- branch-wise --- */

export type BranchDue = {
  branchId: number
  branchName: string
  branchCode: string
  /** Owed on bills this branch raised. */
  outstandingPaise: bigint
  overduePaise: bigint
  openInvoiceCount: number
  /** Collected AT this branch in the period, whoever raised the bill. */
  collectedPaise: bigint
  receiptCount: number
}

/**
 * PRD FR-7.6 — branch-wise outstanding and collections.
 *
 * The two figures deliberately do not have to match. A customer can buy at one
 * shop and pay at another (FR-7.5): the debt stays against the branch that
 * raised the bill, while the cash lands at the branch that took it. A branch
 * showing collections far above what it is owed is doing the group's
 * collecting, not overcharging.
 */
export async function branchDues(
  actor: AuthUser,
  period: { from: Date; to: Date },
  now: Date = new Date(),
): Promise<{ rows: BranchDue[]; totalOutstandingPaise: bigint; totalCollectedPaise: bigint }> {
  const scope = branchScope(actor, null)
  const visible = (id: number) => scope === null || scope.includes(id)

  const branches = await db
    .select({ id: branch.id, name: branch.name, code: branch.code })
    .from(branch)
    .where(eq(branch.businessId, actor.businessId))
    .orderBy(asc(branch.name))

  const openRows = await db
    .select({
      branchId: sale.branchId,
      soldAt: sale.soldAt,
      dueDate: sale.dueDate,
      totalPaise: sale.totalPaise,
      receivedPaise: saleReceivedSql(),
    })
    .from(sale)
    .where(
      and(
        eq(sale.businessId, actor.businessId),
        isNotNull(sale.customerId),
        eq(sale.status, 'COMPLETED'),
      ),
    )

  const collected = await db
    .select({
      branchId: customerPayment.branchId,
      total: sql<string>`coalesce(sum(${customerPayment.amountPaise}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(customerPayment)
    .where(
      and(
        eq(customerPayment.businessId, actor.businessId),
        // A voided receipt collected nothing.
        isNull(customerPayment.voidedAt),
        // Typed operators rather than a raw fragment: a Date interpolated
        // into raw SQL is not encoded for the column and throws at bind time.
        gte(customerPayment.receivedOn, period.from),
        lt(customerPayment.receivedOn, period.to),
      ),
    )
    .groupBy(customerPayment.branchId)

  const collectedById = new Map(collected.map((c) => [c.branchId, c]))

  const rows: BranchDue[] = branches.filter((b) => visible(b.id)).map((b) => ({
    branchId: b.id,
    branchName: b.name,
    branchCode: b.code,
    outstandingPaise: 0n,
    overduePaise: 0n,
    openInvoiceCount: 0,
    collectedPaise: BigInt(collectedById.get(b.id)?.total ?? '0'),
    receiptCount: collectedById.get(b.id)?.n ?? 0,
  }))
  const byId = new Map(rows.map((r) => [r.branchId, r]))

  for (const r of openRows) {
    const owing = r.totalPaise - BigInt(r.receivedPaise)
    if (owing <= 0n) continue
    const entry = byId.get(r.branchId)
    if (!entry) continue
    entry.outstandingPaise += owing
    entry.openInvoiceCount += 1
    if (r.dueDate && r.dueDate.getTime() < now.getTime()) entry.overduePaise += owing
  }

  return {
    // Every branch, including quiet ones. Dropping branches with no activity
    // hid the whole comparison exactly when it was most useful - a two-branch
    // shop where only one has dues - and a zero row is itself information:
    // "this branch collected nothing this month".
    rows,
    totalOutstandingPaise: rows.reduce((sum, r) => sum + r.outstandingPaise, 0n),
    totalCollectedPaise: rows.reduce((sum, r) => sum + r.collectedPaise, 0n),
  }
}
