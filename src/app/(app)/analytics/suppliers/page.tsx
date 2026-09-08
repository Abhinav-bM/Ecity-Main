import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  growthBasisPoints,
  previousRange,
  productsFromSupplier,
  selectableBranches,
  supplierAnalytics,
  supplierOutstandingTotal,
  supplierPaymentsTotal,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-24. What we buy, from whom, and what is still owed. */
export default async function SupplierAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.view')) redirect('/analytics')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, suppliers, outstanding, paid, products, beforeSuppliers] = await Promise.all([
    selectableBranches(session.user),
    supplierAnalytics(session.user, range),
    supplierOutstandingTotal(session.user),
    supplierPaymentsTotal(session.user, range),
    productsFromSupplier(session.user, range),
    supplierAnalytics(session.user, previousRange(range)),
  ])

  const bought = suppliers.reduce((sum, s) => sum + s.valuePaise, 0n)

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/suppliers"
      />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="supplier-figures">
        <Figure
          label="Purchased"
          value={formatMoney(bought)}
          href="/purchases"
          changeBp={
            compare
              ? growthBasisPoints(
                  bought,
                  beforeSuppliers.reduce((sum, s) => sum + s.valuePaise, 0n),
                )
              : undefined
          }
        />
        <Figure label="Paid in this period" value={formatMoney(paid)} />
        <Figure
          label="Still owed"
          value={formatMoney(outstanding > 0n ? outstanding : 0n)}
          hint="Across every branch — a supplier is shared"
          href="/purchases/supplier-dues"
        />
      </div>

      <BarChart
        title="Purchases by supplier"
        testId="supplier-chart"
        rows={suppliers.map((s) => ({ label: s.supplierName, valuePaise: s.valuePaise }))}
      />

      <DataTable
        title="Every supplier"
        testId="supplier-table"
        rows={suppliers as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'Supplier',
            cell: (r) => (
              <Link href={`/suppliers/${r.supplierId}`} className="underline-offset-4 hover:underline">
                {String(r.supplierName)}
              </Link>
            ),
          },
          { header: 'Purchases', align: 'right', cell: (r) => String(r.purchases) },
          { header: 'Value', align: 'right', cell: (r) => formatMoney(r.valuePaise as bigint) },
        ]}
      />

      {/* FR-24. What we actually buy, and from whom. */}
      <DataTable
        title="What we buy, and from whom"
        testId="supplier-products-table"
        rows={products as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Supplier', cell: (r) => String(r.supplierName) },
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Value', align: 'right', cell: (r) => formatMoney(r.valuePaise as bigint) },
        ]}
      />
    </div>
  )
}
