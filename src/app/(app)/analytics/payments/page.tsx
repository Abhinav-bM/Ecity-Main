import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import {
  growthBasisPoints,
  paymentMix,
  previousRange,
  selectableBranches,
  supplierPaymentsTotal,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-23. How customers actually pay, and what that means for the till. */
export default async function PaymentAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, mix, paidOut, before] = await Promise.all([
    selectableBranches(session.user),
    paymentMix(session.user, range),
    supplierPaymentsTotal(session.user, range),
    paymentMix(session.user, previousRange(range)),
  ])

  /* Credit is a way of paying, so it belongs beside the methods. */
  const rows = [
    ...mix.methods.map((m) => ({ label: m.methodName, valuePaise: m.amountPaise })),
    ...(mix.creditPaise > 0n ? [{ label: 'On credit', valuePaise: mix.creditPaise }] : []),
  ]

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/payments"
      />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="payment-figures">
        <Figure label="Billed" value={formatMoney(mix.revenuePaise)} />
        <Figure
          label="Taken at the counter"
          value={formatMoney(mix.takenPaise)}
          changeBp={compare ? growthBasisPoints(mix.takenPaise, before.takenPaise) : undefined}
        />
        <Figure label="Paid to suppliers" value={formatMoney(paidOut)} href="/purchases/supplier-dues" />
      </div>

      <BarChart title="How customers paid" testId="payment-chart" rows={rows} />

      <DataTable
        title="By method"
        description="Reconciliation: these are what the day should have taken, per method."
        testId="payment-table"
        rows={rows as unknown as Record<string, unknown>[]}
        columns={[
          { header: 'Method', cell: (r) => String(r.label) },
          { header: 'Amount', align: 'right', cell: (r) => formatMoney(r.valuePaise as bigint) },
        ]}
      />
    </div>
  )
}
