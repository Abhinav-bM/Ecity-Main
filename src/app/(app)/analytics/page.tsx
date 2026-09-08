import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  growthBasisPoints,
  previousRange,
  profitSummary,
  salesByBranch,
  salesTotals,
  selectableBranches,
  stockOnHand,
} from '@/server/services/analytics.service'
import { dashboard } from '@/server/services/dashboard.service'
import { RangeControls } from './range-controls'
import { BarChart, DataTable, Figure } from './parts'
import { rangeFromParams, formatBp } from './shared'

export const dynamic = 'force-dynamic'

/** PRD FR-36.1 – FR-36.3. The business, across every branch. */
export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)
  const canSeeProfit = hasPermission(session.user, 'analytics.view_profit')

  const [branches, now, before, byBranch, stock, profit, money] = await Promise.all([
    selectableBranches(session.user),
    salesTotals(session.user, range),
    salesTotals(session.user, previousRange(range)),
    salesByBranch(session.user, range),
    stockOnHand(session.user, range),
    canSeeProfit ? profitSummary(session.user, range) : Promise.resolve(null),
    // FR-36.2 wants cash, dues and stock value on the owner's overview too.
    dashboard(session.user, range.branchIds),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="overview-figures">
        <Figure
          label="Revenue"
          value={formatMoney(now.revenuePaise)}
          changeBp={compare ? growthBasisPoints(now.revenuePaise, before.revenuePaise) : undefined}
          href="/analytics/sales"
        />
        <Figure
          label="Bills"
          value={String(now.orders)}
          hint={`${now.units} items`}
          changeBp={
            compare ? growthBasisPoints(BigInt(now.orders), BigInt(before.orders)) : undefined
          }
          href="/sales"
        />
        <Figure label="Average bill" value={formatMoney(now.averageOrderPaise)} />
        {profit ? (
          <Figure
            label="Gross profit"
            value={formatMoney(profit.grossProfitPaise)}
            hint={`${formatBp(profit.marginBasisPoints)} margin`}
            href="/analytics/profit"
          />
        ) : (
          <Figure label="Stock value" value={formatMoney(stock.valuePaise)} href="/analytics/inventory" />
        )}
      </div>

      {/* FR-36.2. The money, beside the trade. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="overview-money">
        <Figure label="Cash in the till" value={formatMoney(money.cashPaise)} href="/cash" />
        <Figure label="In accounts" value={formatMoney(money.accountsPaise)} href="/accounts" />
        <Figure
          label="Customers owe"
          value={formatMoney(money.customerDuesPaise)}
          href="/analytics/credit"
        />
        <Figure
          label="Stock value"
          value={formatMoney(stock.valuePaise)}
          href="/analytics/inventory"
        />
      </div>

      {/* FR-36.3. Branch comparison — the owner's first question. */}
      <BarChart
        title="Revenue by branch"
        testId="branch-chart"
        rows={byBranch.map((b) => ({
          label: b.branchName,
          valuePaise: b.revenuePaise,
          href: `/analytics/sales?branchId=${b.branchId}&from=${range.from}&to=${range.to}`,
        }))}
      />

      <DataTable
        title="Every branch"
        description="Click a branch to see only its figures."
        testId="branch-table"
        rows={byBranch as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Branch', cell: (r) => String(r.branchName) },
          { header: 'Bills', align: 'right', cell: (r) => String(r.orders) },
          {
            header: 'Revenue',
            align: 'right',
            cell: (r) => formatMoney(r.revenuePaise as bigint),
          },
        ]}
      />
    </div>
  )
}
