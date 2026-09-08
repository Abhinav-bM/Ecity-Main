import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import {
  adjustmentCount,
  deadStock,
  inventoryMovement,
  selectableBranches,
  stockAlerts,
  stockByMainType,
  stockOnHand,
  stockTurnover,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-21. What is on the shelf, what moved, and what has not moved at all. */
export default async function InventoryAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, stock, byType, movement, dead, adjustments, turnover, alerts] =
    await Promise.all([
      selectableBranches(session.user),
      stockOnHand(session.user, range),
      stockByMainType(session.user, range),
      inventoryMovement(session.user, range),
      deadStock(session.user, range),
      adjustmentCount(session.user, range),
      stockTurnover(session.user, range),
      stockAlerts(session.user, range),
    ])

  /*
   * FR-21's movement row. Reconstructed from the stock ledger and worked back
   * from what is on the shelf now, so opening + in - out = current always
   * closes — a movement report that does not reconcile is worse than none.
   */
  const steps = [
    { step: 'Opening', units: movement.opening },
    { step: 'Purchases', units: movement.purchases },
    { step: 'Sales', units: -movement.sales },
    { step: 'Returns', units: movement.returns },
    { step: 'Transfers in', units: movement.transfersIn },
    { step: 'Transfers out', units: -movement.transfersOut },
    { step: 'Adjustments', units: movement.adjustments },
    { step: 'Current', units: movement.current },
  ]

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/inventory"
        comparable={false}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="inventory-figures">
        <Figure label="Stock value" value={formatMoney(stock.valuePaise)} />
        <Figure label="Handsets" value={String(stock.deviceUnits)} href="/devices" />
        <Figure label="Accessory units" value={String(stock.accessoryUnits)} />
        <Figure
          label="Adjustments"
          value={String(adjustments)}
          hint="Corrections in this period"
          href="/adjustments"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="inventory-health">
        <Figure
          label="Turnover"
          value={
            turnover.turnoverBasisPoints === null
              ? '—'
              : `${(turnover.turnoverBasisPoints / 100).toFixed(1)}x`
          }
          hint={`${turnover.unitsSold} sold against ${turnover.unitsHeld} held`}
        />
        <Figure
          label="Low stock"
          value={String(alerts.low.length)}
          hint="At or below the reorder point"
          href="/inventory/low-stock"
        />
        <Figure
          label="Out of stock"
          value={String(alerts.outOfStock.length)}
          hint="Nothing left, and a minimum set"
          href="/inventory/low-stock"
        />
      </div>

      <DataTable
        title="Movement"
        description="Opening → Purchases → Sales → Returns → Adjustments → Current, from the stock ledger."
        testId="movement-table"
        rows={steps as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Step', cell: (r) => String(r.step) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
        ]}
      />

      <BarChart
        title="Stock value by main type"
        testId="inventory-chart"
        rows={byType.map((t) => ({ label: t.label, valuePaise: t.valuePaise }))}
      />

      {/* FR-21. Five main types separately, GLOBAL split by NEW CUT. */}
      <DataTable
        title="Handsets in stock, by main type"
        testId="stock-type-table"
        rows={byType as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Type', cell: (r) => String(r.label) },
          { header: 'Units', align: 'right', cell: (r) => String(r.units) },
          { header: 'Value', align: 'right', cell: (r) => formatMoney(r.valuePaise as bigint) },
        ]}
      />

      <DataTable
        title="Needs reordering"
        description="At or below its minimum, lowest first."
        testId="reorder-table"
        empty="Everything is above its reorder point."
        rows={[...alerts.outOfStock, ...alerts.low] as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Branch', cell: (r) => String(r.branchName) },
          { header: 'On hand', align: 'right', cell: (r) => String(r.quantity) },
          { header: 'Minimum', align: 'right', cell: (r) => String(r.minQuantity) },
        ]}
      />

      <DataTable
        title="Dead stock"
        description="In stock before this period began, and still here. Oldest first."
        testId="dead-stock-table"
        rows={dead as unknown as Record<string, unknown>[]}
        empty="Nothing has been sitting unsold."
        columns={[
          {
            header: 'IMEI',
            cell: (r) => (
              <Link href={`/devices/${r.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                {r.identifier ? String(r.identifier) : `Device #${String(r.id)}`}
              </Link>
            ),
          },
          { header: 'Product', cell: (r) => String(r.productName) },
          { header: 'Type', cell: (r) => String(r.mainType) + (r.isNewCut ? ' · NEW CUT' : '') },
          { header: 'Branch', cell: (r) => (r.branchName ? String(r.branchName) : '—') },
          {
            header: 'Cost',
            align: 'right',
            cell: (r) => (r.costPaise ? formatMoney(r.costPaise as bigint) : '—'),
          },
        ]}
      />
    </div>
  )
}
