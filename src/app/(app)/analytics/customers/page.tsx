import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import {
  customerAnalytics,
  growthBasisPoints,
  previousRange,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-19. Who buys, how often, and how much. */
export default async function CustomerAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, data, before] = await Promise.all([
    selectableBranches(session.user),
    customerAnalytics(session.user, range),
    customerAnalytics(session.user, previousRange(range)),
  ])
  const beforeSpend = before.top.reduce((sum, c) => sum + c.spendPaise, 0n)

  const spend = data.top.reduce((sum, c) => sum + c.spendPaise, 0n)
  const orders = data.top.reduce((sum, c) => sum + c.orders, 0)

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/customers"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="customer-figures">
        <Figure label="New customers" value={String(data.newCustomers)} hint="First ever bill fell in this period" />
        <Figure label="Returning" value={String(data.returningCustomers)} />
        <Figure
          label="Named spend"
          value={formatMoney(spend)}
          hint="Walk-ins are not counted here"
          changeBp={compare ? growthBasisPoints(spend, beforeSpend) : undefined}
        />
        <Figure
          label="Average per bill"
          value={formatMoney(orders > 0 ? spend / BigInt(orders) : 0n)}
        />
      </div>

      <BarChart
        title="Spend by customer"
        testId="customer-chart"
        rows={data.top.slice(0, 10).map((c) => ({
          label: c.customerName,
          valuePaise: c.spendPaise,
          href: `/customers/${c.customerId}`,
        }))}
      />

      <DataTable
        title="Top customers"
        description="By spend in this period. Click through for their whole history."
        testId="customer-table"
        rows={data.top as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'Customer',
            cell: (r) => (
              <Link href={`/customers/${r.customerId}`} className="underline-offset-4 hover:underline">
                {String(r.customerName)}
              </Link>
            ),
          },
          { header: 'Bills', align: 'right', cell: (r) => String(r.orders) },
          { header: 'Spend', align: 'right', cell: (r) => formatMoney(r.spendPaise as bigint) },
          { header: 'New?', cell: (r) => (r.isNew ? 'New' : 'Returning') },
        ]}
      />
    </div>
  )
}
