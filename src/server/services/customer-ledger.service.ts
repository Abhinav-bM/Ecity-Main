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
  tradeIn,
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
    + coalesce((select sum(ti.agreed_value_paise) from trade_in ti
                where ti.sale_id = "sale"."id"), 0)
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

  /*
   * M6. A handset taken in part-exchange settles its agreed value exactly like
   * a payment - it is not a discount, so the bill and its GST stay at the full
   * price (docs/02 M6). Counting it here is what stops an exchange leaving a
   * receivable the customer has already settled in kind.
   */
  const traded = await tx
    .select({ total: sql<string>`coalesce(sum(${tradeIn.agreedValuePaise}), 0)` })
    .from(tradeIn)
    .where(eq(tradeIn.saleId, saleId))

  return (
    BigInt(counter[0]?.total ?? '0') +
    BigInt(later[0]?.total ?? '0') +
    BigInt(traded[0]?.total ?? '0')
  )
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
/**
 * Just the total owed, for a screen that only shows a figure.
 *
 * `customerDues` reads every open bill so it can age each one — necessary for
 * the dues screen, and pure waste for the dashboard, which prints one number.
 * On a five-year dataset that difference was 1.9 seconds against a
 * two-second target (PRD §9.1); this is the same number in about fifty
 * milliseconds, because the aggregate never leaves the database.
 *
 * Derived from the ledger rather than by re-deriving bills: the ledger is
 * the truth for what a customer owes (docs/03 §4.2), which is also what
 * makes an opening balance count (M11) without any special case here.
 */
export async function customerDuesTotalPaise(actor: AuthUser): Promise<bigint> {
  const rows = await db.execute<{ total: string }>(sql`
    select coalesce(sum(amount_paise), 0)::text as total
    from customer_ledger_entry
    where business_id = ${actor.businessId}
  `)
  const total = BigInt((rows as unknown as { total: string }[])[0]?.total ?? '0')
  // A shop with more credit notes than debts owes nothing; it is not owed
  // a negative amount.
  return total > 0n ? total : 0n
}

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

  /*
   * Only bills that still owe something.
   *
   * The loop below already skips settled bills — but it skipped them *after*
   * every completed sale in the shop's history had been read out of the
   * database and turned into JavaScript objects. On a five-year dataset
   * (900k sales, of which 5% are open) that was 3.3 seconds, and it made the
   * dashboard miss its two-second target: the cost scaled with everything the
   * shop had ever sold rather than with what it is still owed.
   *
   * Moving the same test into SQL leaves the result identical and the work
   * proportional to the debts. Found by the M14 performance pass; a
   * developer's database of a thousand sales never shows it.
   */
  conditions.push(sql`${sale.totalPaise} > ${saleReceivedSql()}`)

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

  /*
   * M11 FR-34.3. A balance carried in from before ECITY has no bill behind it,
   * so it would be invisible to a screen built entirely from sales - and an
   * opening balance nobody can see is worse than not having imported it.
   *
   * Each customer's OPENING entries are aged from the day they were declared,
   * exactly as an unpaid invoice of that date would be, and only what is still
   * outstanding after later payments counts.
   */
  const opening = await db
    .select({
      customerId: customerLedgerEntry.customerId,
      customerName: customer.name,
      phone: customer.phone,
      occurredAt: sql<string>`min(${customerLedgerEntry.occurredAt})`,
      /*
       * The whole account, not just the opening line: a payment posted against
       * an old debt reduces it, and pretending otherwise would show money as
       * owed twice - once here and once against whatever bill it settled.
       */
      balancePaise: sql<string>`(
        select coalesce(sum(e.amount_paise), 0)
        from customer_ledger_entry e
        where e.customer_id = "customer_ledger_entry"."customer_id"
      )`,
    })
    .from(customerLedgerEntry)
    .innerJoin(customer, eq(customer.id, customerLedgerEntry.customerId))
    .where(
      and(
        eq(customerLedgerEntry.businessId, actor.businessId),
        eq(customerLedgerEntry.entryType, 'OPENING'),
      ),
    )
    .groupBy(customerLedgerEntry.customerId, customer.name, customer.phone)

  for (const o of opening) {
    // Already counted through their bills, or since settled.
    if (byCustomer.has(o.customerId)) continue
    const owing = BigInt(o.balancePaise)
    if (owing <= 0n) continue

    const from = new Date(o.occurredAt)
    const days = daysBetween(from, now)
    const entry: CustomerDue = {
      customerId: o.customerId,
      customerName: o.customerName,
      phone: o.phone,
      balancePaise: owing,
      buckets: emptyBuckets(),
      oldestDueDate: from,
      // Carried in from before the system: overdue by definition.
      overduePaise: owing,
      openInvoiceCount: 0,
    }
    entry.buckets[agingBucket(days)] += owing
    byCustomer.set(o.customerId, entry)
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
