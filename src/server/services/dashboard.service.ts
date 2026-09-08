import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { branch, branchStock, cashDrawerDay, dailyClosing, product, sale } from '@/server/db/schema'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { shopDateString } from '@/lib/date'
import { customerDues } from './customer-ledger.service'
import { supplierOutstanding } from './supplier-ledger.service'
import { expectedCashPaise } from './cash.service'
import {
  listAccounts,
  type AccountBalance,
} from './cash.service'
import {
  profitSummary,
  purchaseTotals,
  returnsTotals,
  salesTotals,
  stockOnHand,
  type Range,
} from './analytics.service'

/**
 * The dashboard (PRD FR-15.1 – FR-15.3).
 *
 * Today's figures, live. Everything here is the same query layer the analytics
 * pages use with the range set to today, so the dashboard and the sales page
 * cannot disagree about what today did.
 */

export type Alert = {
  kind: 'LOW_STOCK' | 'OVERDUE_DUES' | 'UNCLOSED_DAY' | 'CASH_MISMATCH'
  title: string
  detail: string
  href: string
}

export async function dashboard(actor: AuthUser, branchIds?: number[]) {
  const range: Range = { from: shopDateString(), to: shopDateString(), branchIds }
  const canSeeProfit = hasPermission(actor, 'analytics.view_profit')

  const [sales, purchases, returns, stock, profit, accounts, dues, supplierDues, alerts] =
    await Promise.all([
      salesTotals(actor, range),
      hasPermission(actor, 'purchase.view')
        ? purchaseTotals(actor, range)
        : Promise.resolve({ count: 0, valuePaise: 0n }),
      returnsTotals(actor, range),
      stockOnHand(actor, range),
      canSeeProfit ? profitSummary(actor, range) : Promise.resolve(null),
      hasPermission(actor, 'account.view')
        ? listAccounts(actor)
        : Promise.resolve([] as AccountBalance[]),
      hasPermission(actor, 'customer_payment.view')
        ? customerDues(actor, { page: 1, pageSize: 1 })
        : Promise.resolve(null),
      hasPermission(actor, 'supplier_payment.view')
        ? supplierOutstanding(actor, 1, 1)
        : Promise.resolve(null),
      dashboardAlerts(actor, branchIds),
    ])

  const cashPaise = await cashAcrossBranches(actor, branchIds)

  return {
    date: range.from,
    sales,
    purchases,
    returns,
    stock,
    profit,
    cashPaise,
    accountsPaise: accounts.reduce((sum, a) => sum + a.balancePaise, 0n),
    customerDuesPaise: dues?.totalPaise ?? 0n,
    supplierDuesPaise: supplierDues?.totalOwedPaise ?? 0n,
    alerts,
  }
}

/** Expected cash today, summed over the branches in view. */
async function cashAcrossBranches(actor: AuthUser, branchIds?: number[]): Promise<bigint> {
  const scope = branchScope(actor, null)
  const rows = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.businessId, actor.businessId), eq(branch.status, 'ACTIVE')))

  const visible = rows
    .map((r) => r.id)
    .filter((id) => (scope === null || scope.includes(id)))
    .filter((id) => !branchIds?.length || branchIds.includes(id))

  const day = shopDateString()
  const totals = await Promise.all(visible.map((id) => expectedCashPaise(id, day)))
  return totals.reduce((sum, v) => sum + v, 0n)
}

/**
 * FR-15.3. The four things worth interrupting someone about.
 *
 * Each is a question the owner would otherwise have to go looking for, and
 * each links straight to the screen that answers it.
 */
export async function dashboardAlerts(
  actor: AuthUser,
  branchIds?: number[],
): Promise<Alert[]> {
  const scope = branchScope(actor, null)
  // One rule, four tables — so the alerts cannot disagree about scope.
  const branchFilter = (col: AnyPgColumn) => {
    const ids = branchIds?.length
      ? branchIds.filter((id) => scope === null || scope.includes(id))
      : (scope ?? null)
    return ids ? sql`${col} in ${ids.length ? ids : [-1]}` : undefined
  }

  const alerts: Alert[] = []
  const day = shopDateString()

  if (hasPermission(actor, 'inventory.view')) {
    const low = await db
      .select({ n: sql<string>`count(*)` })
      .from(branchStock)
      .innerJoin(product, eq(product.id, branchStock.productId))
      .where(
        and(
          eq(product.businessId, actor.businessId),
          sql`${branchStock.quantity} <= ${branchStock.minQuantity}`,
          sql`${branchStock.minQuantity} > 0`,
          branchFilter(branchStock.branchId),
        ),
      )
    const n = Number(low[0]?.n ?? 0)
    if (n > 0) {
      alerts.push({
        kind: 'LOW_STOCK',
        title: `${n} product${n === 1 ? '' : 's'} at or below its minimum`,
        detail: 'Reorder before the shelf is empty.',
        href: '/inventory/low-stock',
      })
    }
  }

  if (hasPermission(actor, 'customer_payment.view')) {
    const overdue = await db
      .select({ n: sql<string>`count(*)` })
      .from(sale)
      .where(
        and(
          eq(sale.businessId, actor.businessId),
          sql`${sale.dueDate} is not null`,
          lt(sale.dueDate, new Date()),
          sql`${sale.status} <> 'VOIDED'`,
          branchFilter(sale.branchId),
        ),
      )
    const n = Number(overdue[0]?.n ?? 0)
    if (n > 0) {
      alerts.push({
        kind: 'OVERDUE_DUES',
        title: `${n} bill${n === 1 ? '' : 's'} past its due date`,
        detail: 'Money owed that was expected by now.',
        href: '/customers/dues?overdue=1',
      })
    }
  }

  if (hasPermission(actor, 'closing.view')) {
    /*
     * A day with money in the drawer that nobody signed off. Yesterday and
     * earlier only - today is still open by design.
     */
    const unclosed = await db
      .select({ n: sql<string>`count(*)` })
      .from(cashDrawerDay)
      .where(
        and(
          eq(cashDrawerDay.businessId, actor.businessId),
          eq(cashDrawerDay.status, 'OPEN'),
          sql`${cashDrawerDay.businessDate} < ${day}`,
          branchFilter(cashDrawerDay.branchId),
        ),
      )
    const n = Number(unclosed[0]?.n ?? 0)
    if (n > 0) {
      alerts.push({
        kind: 'UNCLOSED_DAY',
        title: `${n} day${n === 1 ? '' : 's'} never closed`,
        detail: 'A day nobody counted cannot be reconciled later.',
        href: '/closing/history',
      })
    }

    const mismatched = await db
      .select({ n: sql<string>`count(*)` })
      .from(dailyClosing)
      .where(
        and(
          eq(dailyClosing.businessId, actor.businessId),
          sql`${dailyClosing.cashDifferencePaise} <> 0`,
          isNull(dailyClosing.voidedAt),
          sql`${dailyClosing.businessDate} >= ${shiftDays(day, -7)}`,
          branchFilter(dailyClosing.branchId),
        ),
      )
    const m = Number(mismatched[0]?.n ?? 0)
    if (m > 0) {
      alerts.push({
        kind: 'CASH_MISMATCH',
        title: `${m} closing${m === 1 ? '' : 's'} did not balance this week`,
        detail: 'Counted cash differed from what was expected.',
        href: '/closing/history',
      })
    }
  }

  return alerts
}

/** yyyy-mm-dd shifted by whole days, without touching a Date's timezone. */
function shiftDays(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}
