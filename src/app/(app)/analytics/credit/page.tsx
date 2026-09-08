import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { customerDues } from '@/server/services/customer-ledger.service'
import {
  collectionPerformance,
  paymentMix,
  repeatedlyOverdue,
  selectableBranches,
} from '@/server/services/analytics.service'
import { RangeControls } from '../range-controls'
import { BarChart, DataTable, Figure } from '../parts'
import { rangeFromParams } from '../shared'

export const dynamic = 'force-dynamic'

/** PRD FR-20. What is owed, how old it is, and who keeps being late. */
export default async function CreditAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer_payment.view')) redirect('/analytics')

  const p = await searchParams
  const { range, branchId, compare } = rangeFromParams(p)

  const [branches, dues, mix, collection, repeat] = await Promise.all([
    selectableBranches(session.user),
    customerDues(session.user, { page: 1, pageSize: 25 }),
    paymentMix(session.user, range),
    collectionPerformance(session.user, range),
    repeatedlyOverdue(session.user, range),
  ])

  return (
    <div className="space-y-4">
      <RangeControls
        branches={branches}
        from={range.from}
        to={range.to}
        branchId={branchId}
        compare={compare}
        basePath="/analytics/credit"
        comparable={false}
      />

      {/* FR-20's aging buckets, over every debtor rather than this page. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="aging-buckets">
        {(['0-7', '8-30', '31-60', '60+'] as const).map((bucket) => (
          <Figure
            key={bucket}
            label={bucket === '60+' ? 'Over 60 days' : `${bucket} days`}
            value={formatMoney(dues.totals[bucket])}
          />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Owed in total" value={formatMoney(dues.totalPaise)} href="/customers/dues" />
        <Figure label="Given on credit in this period" value={formatMoney(mix.creditPaise)} />
        <Figure label="Taken at the counter" value={formatMoney(mix.takenPaise)} />
      </div>

      <BarChart
        title="What is owed, by age"
        testId="aging-chart"
        rows={(['0-7', '8-30', '31-60', '60+'] as const).map((b) => ({
          label: b === '60+' ? 'Over 60 days' : `${b} days`,
          valuePaise: dues.totals[b],
        }))}
      />

      {/*
        FR-20. How well the shop collects. Above 100% is normal and correct —
        money often arrives for bills raised before this period.
      */}
      <div className="grid gap-3 sm:grid-cols-2" data-testid="collection-performance">
        <Figure
          label="Collected in this period"
          value={formatMoney(collection.collectedPaise)}
          href="/customers/dues"
        />
        <Figure
          label="Collection rate"
          value={
            collection.rateBasisPoints === null
              ? '—'
              : `${(collection.rateBasisPoints / 100).toFixed(0)}%`
          }
          hint="Collected against credit given in the same period"
        />
      </div>

      {/* FR-20. One late bill is a slow week; several is a pattern. */}
      <DataTable
        title="Late more than once"
        description="Customers with two or more bills past their due date and still owing."
        testId="repeat-overdue-table"
        empty="Nobody is repeatedly late."
        rows={repeat as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'Customer',
            cell: (r) => (
              <Link href={`/customers/${r.customerId}`} className="underline-offset-4 hover:underline">
                {String(r.customerName)}
              </Link>
            ),
          },
          { header: 'Overdue bills', align: 'right', cell: (r) => String(r.overdueBills) },
          { header: 'Owed', align: 'right', cell: (r) => formatMoney(r.owedPaise as bigint) },
        ]}
      />

      <DataTable
        title="Who owes what"
        description="Aged by bill, so one customer can appear in several buckets."
        testId="dues-table"
        rows={dues.rows as unknown as Record<string, unknown>[]}
        columns={[
          {
            header: 'Customer',
            cell: (r) => (
              <Link href={`/customers/${r.customerId}`} className="underline-offset-4 hover:underline">
                {String(r.customerName)}
              </Link>
            ),
          },
          { header: 'Owed', align: 'right', cell: (r) => formatMoney(r.balancePaise as bigint) },
          {
            header: 'Oldest due',
            cell: (r) =>
              r.oldestDueDate ? new Date(r.oldestDueDate as string).toISOString().slice(0, 10) : '—',
          },
        ]}
      />
    </div>
  )
}
