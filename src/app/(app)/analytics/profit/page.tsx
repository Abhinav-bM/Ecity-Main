import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  byMainType,
  growthBasisPoints,
  previousRange,
  productPerformance,
  profitSummary,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams, formatBp } from '../shared'
import { MainTypeFilter } from './main-type-filter'
import { MAIN_TYPES } from '@/lib/validation'
import type { MainType } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

/** PRD FR-22. Revenue, COGS, gross and estimated net, filterable by main type. */
export default async function ProfitAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  // Profit needs cost prices, which is its own permission.
  if (!hasPermission(session.user, 'analytics.view_profit')) redirect('/analytics')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const mainType = MAIN_TYPES.includes(p.mainType as MainType)
    ? (p.mainType as MainType)
    : undefined
  // FR-22: NEW CUT filtering *within* GLOBAL, never as a type of its own.
  const isNewCut = p.newCut === '1' ? true : p.newCut === '0' ? false : undefined

  const [branches, now, before, types, products] = await Promise.all([
    selectableBranches(session.user),
    profitSummary(session.user, range),
    profitSummary(session.user, previousRange(range)),
    byMainType(session.user, range),
    productPerformance(session.user, range, { mainType, isNewCut, limit: 25 }),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/profit"
      />

      <MainTypeFilter mainType={mainType ?? ''} newCut={p.newCut ?? ''} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="profit-figures">
        <Figure
          label="Revenue"
          value={formatMoney(now.revenuePaise)}
          changeBp={compare ? growthBasisPoints(now.revenuePaise, before.revenuePaise) : undefined}
        />
        <Figure label="Cost of goods" value={formatMoney(now.cogsPaise)} />
        <Figure
          label="Gross profit"
          value={formatMoney(now.grossProfitPaise)}
          hint={`${formatBp(now.marginBasisPoints)} margin`}
          changeBp={
            compare ? growthBasisPoints(now.grossProfitPaise, before.grossProfitPaise) : undefined
          }
        />
        <Figure label="Expenses" value={formatMoney(now.expensesPaise)} href="/expenses" />
        <Figure
          label="Estimated net"
          value={formatMoney(now.netProfitPaise)}
          hint="Gross less recorded expenses"
        />
      </div>

      <BarChart
        title="Profit by main type"
        testId="profit-chart"
        rows={types.map((t) => ({ label: t.label, valuePaise: t.profitPaise }))}
      />

      <DataTable
        title="By main type"
        description="GLOBAL is split so NEW CUT can be judged separately."
        testId="profit-type-table"
        rows={types as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Type', cell: (r) => String(r.label) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
          { header: 'Cost', align: 'right', cell: (r) => formatMoney(r.costPaise as bigint) },
          { header: 'Profit', align: 'right', cell: (r) => formatMoney(r.profitPaise as bigint) },
          { header: 'Margin', align: 'right', cell: (r) => formatBp(r.marginBasisPoints as number) },
        ]}
      />

      <DataTable
        title="By product"
        description="Most profitable first, inside whatever filter is set above."
        testId="profit-product-table"
        rows={products as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenuePaise as bigint) },
          { header: 'Profit', align: 'right', cell: (r) => formatMoney(r.profitPaise as bigint) },
          { header: 'Margin', align: 'right', cell: (r) => formatBp(r.marginBasisPoints as number) },
        ]}
      />
    </div>
  )
}
