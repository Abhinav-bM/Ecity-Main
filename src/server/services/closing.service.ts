import { and, asc, desc, eq, gte, isNull, lt, lte, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  appUser,
  branch,
  cashDrawerDay,
  customerPayment,
  dailyClosing,
  paymentMethod,
  refund,
  sale,
  saleItem,
  salePayment,
  salesReturn,
  supplierPayment,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { businessDateFor, expectedCashPaise } from './cash.service'
import { expenseTotalsFor } from './expense.service'

/**
 * Daily closing (PRD FR-13.1 – FR-13.5).
 *
 * PRD OQ-5, answered: a closing is a person counting the money and signing
 * that it matched, so the figures are STAMPED and never rewritten. A later
 * correction is a new entry in that day; the signed expected/counted/difference
 * stay as they were, and the gap between them and a recomputed figure is what
 * `correctedAfterClose` surfaces.
 *
 * The alternative - letting an owner edit a closed day - was rejected because
 * it is the straightforward way to hide a till shortage: come up short today,
 * adjust yesterday, the difference disappears.
 */

/** A whole business day, in the shop's timezone, as a half-open range. */
function dayRange(businessDate: string): { from: Date; to: Date } {
  const from = new Date(`${businessDate}T00:00:00+05:30`)
  const to = new Date(from.getTime() + 86_400_000)
  return { from, to }
}

export type MethodTotal = {
  paymentMethodId: number
  methodName: string
  affectsCashDrawer: boolean
  expectedPaise: bigint
}

export type DaySummary = {
  branchId: number
  branchName: string
  businessDate: string
  /** FR-13.1. */
  invoiceCount: number
  itemCount: number
  salesPaise: bigint
  returnsPaise: bigint
  creditIssuedPaise: bigint
  creditCollectedPaise: bigint
  refundsPaise: bigint
  supplierPaymentsPaise: bigint
  expensesPaise: bigint
  expensesByCategory: { categoryName: string; totalPaise: bigint }[]
  /** FR-13.2. Expected per method, cash included. */
  methodTotals: MethodTotal[]
  expectedCashPaise: bigint
  openingCashPaise: bigint
  drawerStatus: 'OPEN' | 'CLOSED'
  /** The live closing for this day, if it has been closed. */
  closing: typeof dailyClosing.$inferSelect | null
  /** OQ-5. Something landed in this day after it was signed off. */
  correctedAfterClose: boolean
}

/**
 * Everything the closing screen needs for one branch on one day.
 *
 * Computed from the movements every time it is asked for. The closing row
 * stores its own copy at the moment it is signed; the two are meant to be
 * compared, not conflated.
 */
export async function daySummary(
  actor: AuthUser,
  branchId: number,
  businessDate: string,
): Promise<DaySummary> {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(branchId)) throw notFound('Branch')

  const branchRow = (
    await db
      .select({ name: branch.name })
      .from(branch)
      .where(and(eq(branch.id, branchId), eq(branch.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!branchRow) throw notFound('Branch')

  const { from, to } = dayRange(businessDate)

  const [
    sales,
    methodRows,
    returns,
    collections,
    refunds,
    supplierPaid,
    items,
    expenses,
    drawer,
    closing,
  ] = await Promise.all([
      db
        .select({
          invoices: sql<string>`count(*)`,
          total: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
        })
        .from(sale)
        .where(
          and(
            eq(sale.branchId, branchId),
            gte(sale.soldAt, from),
            lt(sale.soldAt, to),
            sql`${sale.status} <> 'VOIDED'`,
          ),
        ),

      // FR-13.2. What each method took at the counter today.
      db
        .select({
          paymentMethodId: paymentMethod.id,
          methodName: paymentMethod.name,
          affectsCashDrawer: paymentMethod.affectsCashDrawer,
          total: sql<string>`coalesce(sum(${salePayment.amountPaise}), 0)`,
        })
        .from(salePayment)
        .innerJoin(sale, eq(sale.id, salePayment.saleId))
        .innerJoin(paymentMethod, eq(paymentMethod.id, salePayment.paymentMethodId))
        .where(
          and(
            eq(sale.branchId, branchId),
            gte(sale.soldAt, from),
            lt(sale.soldAt, to),
            sql`${sale.status} <> 'VOIDED'`,
          ),
        )
        .groupBy(paymentMethod.id, paymentMethod.name, paymentMethod.affectsCashDrawer)
        .orderBy(asc(paymentMethod.name)),

      db
        .select({ total: sql<string>`coalesce(sum(${salesReturn.totalPaise}), 0)` })
        .from(salesReturn)
        .where(
          and(
            eq(salesReturn.branchId, branchId),
            gte(salesReturn.returnedAt, from),
            lt(salesReturn.returnedAt, to),
          ),
        ),

      db
        .select({ total: sql<string>`coalesce(sum(${customerPayment.amountPaise}), 0)` })
        .from(customerPayment)
        .where(
          and(
            eq(customerPayment.branchId, branchId),
            gte(customerPayment.receivedOn, from),
            lt(customerPayment.receivedOn, to),
            isNull(customerPayment.voidedAt),
          ),
        ),

      db
        .select({ total: sql<string>`coalesce(sum(${refund.amountPaise}), 0)` })
        .from(refund)
        .where(
          and(
            eq(refund.branchId, branchId),
            gte(refund.refundedAt, from),
            lt(refund.refundedAt, to),
          ),
        ),

      db
        .select({ total: sql<string>`coalesce(sum(${supplierPayment.amountPaise}), 0)` })
        .from(supplierPayment)
        .where(
          and(
            eq(supplierPayment.branchId, branchId),
            gte(supplierPayment.paidOn, from),
            lt(supplierPayment.paidOn, to),
            isNull(supplierPayment.voidedAt),
          ),
        ),

      /*
       * FR-13.1. Units sold, not lines - two of the same cable is two. Its own
       * query rather than a join onto the sale aggregate above, which would
       * multiply each bill's total by its number of lines.
       */
      db
        .select({ units: sql<string>`coalesce(sum(${saleItem.quantity}), 0)` })
        .from(saleItem)
        .innerJoin(sale, eq(sale.id, saleItem.saleId))
        .where(
          and(
            eq(sale.branchId, branchId),
            gte(sale.soldAt, from),
            lt(sale.soldAt, to),
            sql`${sale.status} <> 'VOIDED'`,
          ),
        ),

      expenseTotalsFor(branchId, businessDate),

      db
        .select({ status: cashDrawerDay.status, opening: cashDrawerDay.openingPaise })
        .from(cashDrawerDay)
        .where(
          and(eq(cashDrawerDay.branchId, branchId), eq(cashDrawerDay.businessDate, businessDate)),
        )
        .limit(1),

      db
        .select()
        .from(dailyClosing)
        .where(
          and(
            eq(dailyClosing.branchId, branchId),
            eq(dailyClosing.businessDate, businessDate),
            isNull(dailyClosing.voidedAt),
          ),
        )
        .limit(1),
    ])

  const expected = await expectedCashPaise(branchId, businessDate)
  const salesPaise = BigInt(sales[0]?.total ?? '0')
  const takenAtCounter = methodRows.reduce((sum, m) => sum + BigInt(m.total), 0n)

  const closingRow = closing[0] ?? null
  /*
   * OQ-5. The closing keeps the number it was signed with. If the drawer now
   * computes to something else, a correction landed after the signature - and
   * that is exactly what should be visible rather than smoothed over.
   */
  const correctedAfterClose =
    closingRow !== null && closingRow.expectedCashPaise !== expected

  return {
    branchId,
    branchName: branchRow.name,
    businessDate,
    invoiceCount: Number(sales[0]?.invoices ?? 0),
    itemCount: Number(items[0]?.units ?? 0),
    salesPaise,
    returnsPaise: BigInt(returns[0]?.total ?? '0'),
    // What was billed but not taken at the counter is credit given today.
    creditIssuedPaise: salesPaise - takenAtCounter,
    creditCollectedPaise: BigInt(collections[0]?.total ?? '0'),
    refundsPaise: BigInt(refunds[0]?.total ?? '0'),
    supplierPaymentsPaise: BigInt(supplierPaid[0]?.total ?? '0'),
    expensesPaise: expenses.reduce((sum, e) => sum + e.totalPaise, 0n),
    expensesByCategory: expenses,
    methodTotals: methodRows.map((m) => ({
      paymentMethodId: m.paymentMethodId,
      methodName: m.methodName,
      affectsCashDrawer: m.affectsCashDrawer,
      expectedPaise: BigInt(m.total),
    })),
    expectedCashPaise: expected,
    openingCashPaise: drawer[0]?.opening ?? 0n,
    drawerStatus: drawer[0]?.status ?? 'OPEN',
    closing: closingRow,
    correctedAfterClose,
  }
}

export type CloseDayInput = {
  branchId: number
  businessDate: string
  countedCashPaise: bigint
  /** FR-13.2. Counted per non-cash method, keyed by payment method id. */
  countedByMethod?: Record<number, bigint>
  notes?: string
  /** M12 hook: closing before the legacy file is in needs a stated reason. */
  externalFeedImported?: boolean
  overrideReason?: string
}

/**
 * Close the day for one branch (FR-13.3).
 *
 * Freezes the drawer and stamps the figures. Refuses a day that is already
 * closed - reopening is a deliberate, separate, audited act (`voidClosing`),
 * not something that happens by closing twice.
 */
export async function closeDay(
  actor: AuthUser,
  ctx: AuditContext,
  input: CloseDayInput,
): Promise<{ id: number; cashDifferencePaise: bigint }> {
  if (input.countedCashPaise < 0n) {
    throw new AppError('Counted cash cannot be negative.', 422, 'BAD_COUNT')
  }
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(input.branchId)) throw notFound('Branch')

  // Closing a day that has not happened yet cannot be reconciled against
  // anything, and would block the day it belongs to.
  if (input.businessDate > businessDateFor()) {
    throw new AppError('That day has not happened yet.', 422, 'FUTURE_DAY')
  }

  const summary = await daySummary(actor, input.branchId, input.businessDate)

  return db.transaction(async (tx) => {
    const existing = (
      await tx
        .select({ id: dailyClosing.id })
        .from(dailyClosing)
        .where(
          and(
            eq(dailyClosing.branchId, input.branchId),
            eq(dailyClosing.businessDate, input.businessDate),
            isNull(dailyClosing.voidedAt),
          ),
        )
        .limit(1)
    )[0]
    if (existing) throw conflict('That day is already closed for this branch.')

    const difference = input.countedCashPaise - summary.expectedCashPaise

    const created = (
      await tx
        .insert(dailyClosing)
        .values({
          businessId: actor.businessId,
          branchId: input.branchId,
          businessDate: input.businessDate,
          expectedCashPaise: summary.expectedCashPaise,
          countedCashPaise: input.countedCashPaise,
          cashDifferencePaise: difference,
          /*
           * FR-13.1, FR-13.2 as signed off. Stored as JSON because it is a
           * frozen statement, never queried across days - the live reports
           * recompute from the movements instead (docs/03 §4.9).
           */
          summary: {
            invoiceCount: summary.invoiceCount,
            itemCount: summary.itemCount,
            salesPaise: summary.salesPaise.toString(),
            returnsPaise: summary.returnsPaise.toString(),
            creditIssuedPaise: summary.creditIssuedPaise.toString(),
            creditCollectedPaise: summary.creditCollectedPaise.toString(),
            refundsPaise: summary.refundsPaise.toString(),
            supplierPaymentsPaise: summary.supplierPaymentsPaise.toString(),
            expensesPaise: summary.expensesPaise.toString(),
            openingCashPaise: summary.openingCashPaise.toString(),
            methods: summary.methodTotals.map((m) => ({
              paymentMethodId: m.paymentMethodId,
              methodName: m.methodName,
              affectsCashDrawer: m.affectsCashDrawer,
              expectedPaise: m.expectedPaise.toString(),
              countedPaise: (input.countedByMethod?.[m.paymentMethodId] ?? null)?.toString() ?? null,
            })),
          },
          notes: input.notes?.trim() || null,
          externalFeedImported: input.externalFeedImported ?? false,
          overrideReason: input.overrideReason?.trim() || null,
          closedBy: actor.id,
        })
        .returning({ id: dailyClosing.id })
    )[0]!

    // Freeze the drawer. Anything landing here now is a correction and says so.
    await tx
      .update(cashDrawerDay)
      .set({ status: 'CLOSED' })
      .where(
        and(
          eq(cashDrawerDay.branchId, input.branchId),
          eq(cashDrawerDay.businessDate, input.businessDate),
        ),
      )

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'daily_closing',
        entityId: created.id,
        summary:
          `Closed ${input.businessDate} — counted ${input.countedCashPaise}, ` +
          `expected ${summary.expectedCashPaise}, difference ${difference}`,
      },
      tx,
    )

    return { id: created.id, cashDifferencePaise: difference }
  })
}

/**
 * Void a closing so the day can be worked on again (PRD OQ-5).
 *
 * For the mistake everyone actually makes: closing at six and then taking a
 * sale at seven. Refused once a LATER day for that branch has been closed,
 * which is what stops this becoming a way to rewrite last month.
 *
 * The voided closing is kept, not deleted - the fact that a day was closed and
 * reopened is part of the record.
 */
export async function voidClosing(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new AppError('Say why the day is being reopened.', 422, 'NO_REASON')

  await db.transaction(async (tx) => {
    const row = (
      await tx
        .select()
        .from(dailyClosing)
        .where(and(eq(dailyClosing.id, id), eq(dailyClosing.businessId, actor.businessId)))
        .limit(1)
    )[0]
    if (!row) throw notFound('Closing')
    if (row.voidedAt) throw conflict('That closing has already been voided.')

    const scope = branchScope(actor, null)
    if (scope !== null && !scope.includes(row.branchId)) throw notFound('Closing')

    const later = (
      await tx
        .select({ businessDate: dailyClosing.businessDate })
        .from(dailyClosing)
        .where(
          and(
            eq(dailyClosing.branchId, row.branchId),
            sql`${dailyClosing.businessDate} > ${row.businessDate}`,
            isNull(dailyClosing.voidedAt),
          ),
        )
        .orderBy(asc(dailyClosing.businessDate))
        .limit(1)
    )[0]
    if (later) {
      throw conflict(
        `${later.businessDate} has already been closed for this branch, so ${row.businessDate} can no longer be reopened. Post a correction into it instead.`,
      )
    }

    await tx
      .update(dailyClosing)
      .set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason.trim() })
      .where(eq(dailyClosing.id, id))

    await tx
      .update(cashDrawerDay)
      .set({ status: 'OPEN' })
      .where(
        and(
          eq(cashDrawerDay.branchId, row.branchId),
          eq(cashDrawerDay.businessDate, row.businessDate),
        ),
      )

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'daily_closing',
        entityId: id,
        summary: `Reopened ${row.businessDate} — ${reason.trim()}`,
      },
      tx,
    )
  })
}

/* ------------------------------------------------------------ reading --- */

export type ClosingFilters = {
  branchId?: number
  from?: string
  to?: string
  page: number
  pageSize: number
}

export async function listClosings(actor: AuthUser, filters: ClosingFilters) {
  const conditions: SQL[] = [eq(dailyClosing.businessId, actor.businessId)]

  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${dailyClosing.branchId} in ${scope.length ? scope : [-1]}`)
  } else if (filters.branchId) {
    conditions.push(eq(dailyClosing.branchId, filters.branchId))
  }
  if (filters.from) conditions.push(gte(dailyClosing.businessDate, filters.from))
  if (filters.to) conditions.push(lte(dailyClosing.businessDate, filters.to))

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: dailyClosing.id,
        branchId: dailyClosing.branchId,
        branchName: branch.name,
        businessDate: dailyClosing.businessDate,
        expectedCashPaise: dailyClosing.expectedCashPaise,
        countedCashPaise: dailyClosing.countedCashPaise,
        cashDifferencePaise: dailyClosing.cashDifferencePaise,
        notes: dailyClosing.notes,
        closedAt: dailyClosing.closedAt,
        closedByName: appUser.name,
        voidedAt: dailyClosing.voidedAt,
        voidReason: dailyClosing.voidReason,
      })
      .from(dailyClosing)
      .innerJoin(branch, eq(branch.id, dailyClosing.branchId))
      .leftJoin(appUser, eq(appUser.id, dailyClosing.closedBy))
      .where(where)
      // Newest first: yesterday matters more than last March.
      .orderBy(desc(dailyClosing.businessDate), desc(dailyClosing.id))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ n: sql<string>`count(*)` }).from(dailyClosing).where(where),
  ])

  return { rows, total: Number(counted[0]?.n ?? 0), page: filters.page, pageSize: filters.pageSize }
}

/**
 * FR-13.5. Every branch's day side by side, and the consolidated total.
 *
 * Recomputed from the movements rather than read off the closings, so a branch
 * that has not closed yet still appears with its expected figure.
 */
export async function reconciliationReport(actor: AuthUser, businessDate: string) {
  const scope = branchScope(actor, null)
  const branches = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(and(eq(branch.businessId, actor.businessId), eq(branch.status, 'ACTIVE')))
    .orderBy(asc(branch.name))

  const visible = branches.filter((b) => scope === null || scope.includes(b.id))
  const days = await Promise.all(visible.map((b) => daySummary(actor, b.id, businessDate)))

  const totals = days.reduce(
    (acc, d) => ({
      salesPaise: acc.salesPaise + d.salesPaise,
      expensesPaise: acc.expensesPaise + d.expensesPaise,
      expectedCashPaise: acc.expectedCashPaise + d.expectedCashPaise,
      countedCashPaise: acc.countedCashPaise + (d.closing?.countedCashPaise ?? 0n),
      differencePaise: acc.differencePaise + (d.closing?.cashDifferencePaise ?? 0n),
    }),
    {
      salesPaise: 0n,
      expensesPaise: 0n,
      expectedCashPaise: 0n,
      countedCashPaise: 0n,
      differencePaise: 0n,
    },
  )

  return { businessDate, days, totals, allClosed: days.every((d) => d.closing !== null) }
}

/** Used by the correction guard in other services. */
export async function isDayClosed(
  branchId: number,
  businessDate: string,
  tx: DbOrTx = db,
): Promise<boolean> {
  const row = (
    await tx
      .select({ status: cashDrawerDay.status })
      .from(cashDrawerDay)
      .where(
        and(eq(cashDrawerDay.branchId, branchId), eq(cashDrawerDay.businessDate, businessDate)),
      )
      .limit(1)
  )[0]
  return row?.status === 'CLOSED'
}
