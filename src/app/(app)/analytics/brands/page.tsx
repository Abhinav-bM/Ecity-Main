import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  brandPerformance,
  growthBasisPoints,
  previousRange,
  salesTotals,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams, formatBp } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-18. Which brands earn, and which do not. */
export default async function BrandAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)
  const canSeeProfit = hasPermission(session.user, 'analytics.view_profit')

  const [branches, brands, now, before] = await Promise.all([
    selectableBranches(session.user),
    brandPerformance(session.user, range),
    salesTotals(session.user, range),
    salesTotals(session.user, previousRange(range)),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/brands"
      />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="brand-figures">
        <Figure
          label="Revenue"
          value={formatMoney(now.revenuePaise)}
          changeBp={compare ? growthBasisPoints(now.revenuePaise, before.revenuePaise) : undefined}
        />
        <Figure label="Brands selling" value={String(brands.length)} />
        <Figure label="Units" value={String(now.units)} />
      </div>

      <BarChart
        title="Revenue by brand"
        testId="brand-chart"
        rows={brands.map((b) => ({ label: b.brandName, valuePaise: b.revenuePaise }))}
      />

      <DataTable
        title="Every brand"
        description="Strongest at the top. A brand with no sales in this period does not appear."
        testId="brand-table"
        rows={brands as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Brand', cell: (r) => String(r.brandName) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
          ...(canSeeProfit
            ? [
                {
                  header: 'Profit',
                  align: 'right' as const,
                  cell: (r: Record<string, unknown>) => formatMoney(r.profitPaise as bigint),
                },
                {
                  header: 'Margin',
                  align: 'right' as const,
                  cell: (r: Record<string, unknown>) => formatBp(r.marginBasisPoints as number),
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}
