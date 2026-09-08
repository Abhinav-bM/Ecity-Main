import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  byMainType,
  growthBasisPoints,
  previousRange,
  productPerformance,
  salesTotals,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams, formatBp } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-17. Best sellers, and GLOBAL analysed with NEW CUT split out. */
export default async function ProductAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)
  const canSeeProfit = hasPermission(session.user, 'analytics.view_profit')

  const [branches, best, types, now, before] = await Promise.all([
    selectableBranches(session.user),
    productPerformance(session.user, range, { limit: 25 }),
    byMainType(session.user, range),
    salesTotals(session.user, range),
    salesTotals(session.user, previousRange(range)),
  ])

  const slow = [...best].sort((a, b) => a.units - b.units).slice(0, 10)

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/products"
      />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="product-figures">
        <Figure
          label="Revenue"
          value={formatMoney(now.revenuePaise)}
          changeBp={compare ? growthBasisPoints(now.revenuePaise, before.revenuePaise) : undefined}
        />
        <Figure label="Units" value={String(now.units)} />
        <Figure label="Products sold" value={String(best.length)} />
      </div>

      <BarChart
        title="Revenue by product"
        testId="product-chart"
        rows={best.slice(0, 10).map((p) => ({
          label: p.productName,
          valuePaise: p.revenuePaise,
          href: `/products/${p.productId}`,
        }))}
      />

      {/*
        FR-17, FR-35.3. The mobile-type dimension is mandatory here, and
        GLOBAL · NEW CUT is its own line — never a sixth main type.
      */}
      <DataTable
        title="By main type"
        description="GLOBAL is split so NEW CUT can be judged on its own."
        testId="main-type-table"
        rows={types as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Type', cell: (r) => String(r.label) },
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

      <DataTable
        title="Best sellers"
        testId="products-table"
        rows={best as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'Product',
            cell: (r) => (
              <Link href={`/products/${r.productId}`} className="underline-offset-4 hover:underline">
                {String(r.productName)}
              </Link>
            ),
          },
          { header: 'Brand', cell: (r) => (r.brandName ? String(r.brandName) : '—') },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
          ...(canSeeProfit
            ? [
                {
                  header: 'Margin',
                  align: 'right' as const,
                  cell: (r: Record<string, unknown>) => formatBp(r.marginBasisPoints as number),
                },
              ]
            : []),
        ]}
      />

      <DataTable
        title="Slow movers"
        description="Sold in this period, but least of all. Dead stock is on the Inventory page."
        rows={slow as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
        ]}
      />
    </div>
  )
}
