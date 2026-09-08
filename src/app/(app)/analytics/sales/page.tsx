import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import {
  growthBasisPoints,
  previousRange,
  returnsTotals,
  salesByBranch,
  salesByDay,
  salesTotals,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-16. Revenue, orders, units, average bill, growth, comparison. */
export default async function SalesAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, now, before, byDay, byBranch, returns] = await Promise.all([
    selectableBranches(session.user),
    salesTotals(session.user, range),
    salesTotals(session.user, previousRange(range)),
    salesByDay(session.user, range),
    salesByBranch(session.user, range),
    returnsTotals(session.user, range),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/sales"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="sales-figures">
        <Figure
          label="Revenue"
          value={formatMoney(now.revenuePaise)}
          changeBp={compare ? growthBasisPoints(now.revenuePaise, before.revenuePaise) : undefined}
        />
        <Figure
          label="Bills"
          value={String(now.orders)}
          changeBp={
            compare ? growthBasisPoints(BigInt(now.orders), BigInt(before.orders)) : undefined
          }
          href="/sales"
        />
        <Figure label="Units" value={String(now.units)} />
        <Figure
          label="Average bill"
          value={formatMoney(now.averageOrderPaise)}
          hint={`${formatMoney(now.discountPaise)} discounted`}
        />
      </div>

      <BarChart
        title="Revenue by day"
        testId="sales-chart"
        rows={byDay.map((d) => ({ label: d.day, valuePaise: d.revenuePaise }))}
      />

      <DataTable
        title="By branch"
        testId="sales-branch-table"
        rows={byBranch as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Branch', cell: (r) => String(r.branchName) },
          { header: 'Bills', align: 'right', cell: (r) => String(r.orders) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
        ]}
      />

      <DataTable
        title="Returns in this period"
        description="Revenue above is what was billed; this is what came back."
        rows={[{ count: returns.count, value: returns.valuePaise, refunded: returns.refundedPaise }]}
        columns={[
          { header: 'Returns', align: 'right', cell: (r) => String(r.count) },
          { header: 'Value', align: 'right', cell: (r) => formatMoney(r.value as bigint) },
          { header: 'Refunded', align: 'right', cell: (r) => formatMoney(r.refunded as bigint) },
        ]}
      />
    </div>
  )
}
