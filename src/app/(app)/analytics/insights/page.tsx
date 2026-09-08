import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { insights, selectableBranches } from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams, formatBp } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-35. What changed, and what is doing well.
 *
 * Everything on this page is measured against the period immediately before,
 * because "revenue was ₹4 lakh" is a fact and "revenue was ₹4 lakh, down 12%"
 * is something to act on.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, i] = await Promise.all([
    selectableBranches(session.user),
    insights(session.user, range),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/insights"
      />

      {/* FR-35.1, FR-35.2. Direction, not just size. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="insight-figures">
        <Figure
          label="Revenue"
          value={formatMoney(i.revenue.nowPaise)}
          changeBp={i.revenue.changeBp}
          hint={`was ${formatMoney(i.revenue.beforePaise)}`}
        />
        <Figure
          label="Average bill"
          value={formatMoney(i.averageOrder.nowPaise)}
          changeBp={i.averageOrder.changeBp}
          hint={`was ${formatMoney(i.averageOrder.beforePaise)}`}
        />
        {i.margin ? (
          <Figure
            label="Margin"
            value={formatBp(i.margin.nowBp)}
            hint={`${i.margin.changePoints >= 0 ? '+' : ''}${(i.margin.changePoints / 100).toFixed(1)} points vs before`}
          />
        ) : null}
        <Figure
          label="Collection rate"
          value={i.credit.rateBasisPoints === null ? '—' : formatBp(i.credit.rateBasisPoints)}
          hint={`${formatMoney(i.credit.collectedPaise)} in, ${formatMoney(i.credit.givenPaise)} given`}
          href="/analytics/credit"
        />
      </div>

      {/* FR-35.1. Best days — grouped by weekday, because that is actionable. */}
      <BarChart
        title="Which days earn"
        testId="weekday-chart"
        rows={i.bestDays.map((d) => ({ label: d.weekday, valuePaise: d.revenuePaise }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DataTable
          title="Top products"
          testId="insight-products-table"
          rows={i.topProducts as unknown as Record<string, unknown>[]}
          columns={[
            { header: 'Product', cell: (r) => String(r.productName) },
            { header: 'Units', align: 'right', cell: (r) => String(r.units) },
            {
              header: 'Revenue',
              align: 'right',
              cell: (r) => formatMoney(r.revenuePaise as bigint),
            },
          ]}
        />
        <DataTable
          title="Top brands"
          testId="insight-brands-table"
          rows={i.topBrands as unknown as Record<string, unknown>[]}
          columns={[
            { header: 'Brand', cell: (r) => String(r.brandName) },
            { header: 'Units', align: 'right', cell: (r) => String(r.units) },
            {
              header: 'Revenue',
              align: 'right',
              cell: (r) => formatMoney(r.revenuePaise as bigint),
            },
          ]}
        />
      </div>

      <DataTable
        title="Best branches"
        testId="insight-branches-table"
        rows={i.topBranches as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Branch', cell: (r) => String(r.branchName) },
          { header: 'Bills', align: 'right', cell: (r) => String(r.orders) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
        ]}
      />

      {/* FR-35.3. The five types compared, GLOBAL split by NEW CUT. */}
      <DataTable
        title="How each type performs"
        description="NEW, USED, ER, ACT and GLOBAL — with NEW CUT judged separately inside GLOBAL."
        testId="insight-types-table"
        rows={i.byMainType as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Type', cell: (r) => String(r.label) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
          { header: 'Margin', align: 'right', cell: (r) => formatBp(r.marginBasisPoints as number) },
        ]}
      />

      <DataTable
        title="Slow-moving stock"
        description="Sitting on a shelf since before this period. Oldest first."
        testId="insight-slow-table"
        empty="Nothing has been sitting unsold."
        rows={i.slowStock as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'IMEI',
            cell: (r) => (
              <Link
                href={`/devices/${r.id}`}
                className="font-mono text-xs underline-offset-4 hover:underline"
              >
                {r.identifier ? String(r.identifier) : `Device #${String(r.id)}`}
              </Link>
            ),
          },
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Branch', cell: (r) => (r.branchName ? String(r.branchName) : '—') },
        ]}
      />
    </div>
  )
}
