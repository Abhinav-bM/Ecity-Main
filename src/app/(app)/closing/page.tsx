import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { businessDateFor } from '@/server/services/cash.service'
import { daySummary } from '@/server/services/closing.service'
import { listBranches } from '@/server/services/branch.service'
import { DrawerControls } from '../cash/drawer-controls'
import { CloseDayPanel } from './close-day-panel'

export const dynamic = 'force-dynamic'

/** PRD FR-13.1 – FR-13.4. The day, and signing off on it. */
export default async function ClosingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'closing.view')) redirect('/dashboard')

  const p = await searchParams
  const branches = await listBranches(session.user)
  const branchId = Number(p.branchId ?? session.activeBranchId ?? branches[0]?.id ?? 0)
  if (!branchId) {
    return <p className="p-6 text-sm text-muted-foreground">No branch to close.</p>
  }

  const businessDate = p.date ?? businessDateFor()
  const day = await daySummary(session.user, branchId, businessDate)
  const canClose = hasPermission(session.user, 'closing.create')
  const canVoid = hasPermission(session.user, 'closing.void')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Daily closing</h1>
          <p className="text-sm text-muted-foreground">
            {day.branchName} · {businessDate}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/closing/history?branchId=${branchId}`}>History</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/closing/reconciliation?date=${businessDate}`}>All branches</Link>
          </Button>
        </div>
      </div>

      <DrawerControls
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        branchId={branchId}
        date={businessDate}
        basePath="/closing"
      />

      {/*
        OQ-5. The closing keeps the figures it was signed with. If the drawer
        now computes to something else, a correction landed afterwards — which
        is exactly what should be visible rather than smoothed over.
      */}
      {day.correctedAfterClose ? (
        <Card className="border-warning">
          <CardContent className="py-3 text-sm">
            <p className="font-medium">This day was corrected after it was closed.</p>
            <p className="text-muted-foreground">
              It was signed off with {formatMoney(day.closing!.expectedCashPaise)} expected. The
              movements now come to {formatMoney(day.expectedCashPaise)}. The signed figures are
              never rewritten, so both are shown.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Sales</p>
          <p className="tabular text-xl font-semibold">{formatMoney(day.salesPaise)}</p>
          <p className="text-xs text-muted-foreground">{day.invoiceCount} invoices</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Credit given</p>
          <p className="tabular text-xl font-semibold">{formatMoney(day.creditIssuedPaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Collected</p>
          <p className="tabular text-xl font-semibold">{formatMoney(day.creditCollectedPaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Returns and refunds</p>
          <p className="tabular text-xl font-semibold">
            {formatMoney(day.returnsPaise)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({formatMoney(day.refundsPaise)} paid out)
            </span>
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Where the cash went</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted-foreground">Opening</dt>
              <dd className="tabular text-right">{formatMoney(day.openingCashPaise)}</dd>
              <dt className="text-muted-foreground">Supplier payments</dt>
              <dd className="tabular text-right">−{formatMoney(day.supplierPaymentsPaise)}</dd>
              <dt className="text-muted-foreground">Expenses</dt>
              <dd className="tabular text-right">−{formatMoney(day.expensesPaise)}</dd>
              <dt className="border-t pt-1 font-medium">Expected in the till</dt>
              <dd
                className="tabular border-t pt-1 text-right font-medium"
                data-testid="closing-expected"
              >
                {formatMoney(day.expectedCashPaise)}
              </dd>
            </dl>
            {day.expensesByCategory.length > 0 ? (
              <dl className="mt-3 grid grid-cols-2 gap-1 border-t pt-2 text-xs text-muted-foreground">
                {day.expensesByCategory.map((e) => (
                  <div key={e.categoryName} className="col-span-2 grid grid-cols-2">
                    <dt>{e.categoryName}</dt>
                    <dd className="tabular text-right">{formatMoney(e.totalPaise)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Taken by method</CardTitle>
          </CardHeader>
          <CardContent>
            {day.methodTotals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing taken at the counter today.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {day.methodTotals.map((m) => (
                  <div key={m.paymentMethodId} className="col-span-2 grid grid-cols-2">
                    <dt className="text-muted-foreground">
                      {m.methodName}
                      {m.affectsCashDrawer ? ' (cash)' : ''}
                    </dt>
                    <dd className="tabular text-right">{formatMoney(m.expectedPaise)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {day.closing ? (
        <Card data-testid="closed-summary">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              Closed
              <Badge
                variant={
                  day.closing.cashDifferencePaise === 0n
                    ? 'success'
                    : day.closing.cashDifferencePaise < 0n
                      ? 'destructive'
                      : 'warning'
                }
              >
                {day.closing.cashDifferencePaise === 0n
                  ? 'Matched'
                  : day.closing.cashDifferencePaise < 0n
                    ? `${formatMoney(-day.closing.cashDifferencePaise)} short`
                    : `${formatMoney(day.closing.cashDifferencePaise)} over`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <dl className="grid grid-cols-2 gap-1">
              <dt className="text-muted-foreground">Expected</dt>
              <dd className="tabular text-right">
                {formatMoney(day.closing.expectedCashPaise)}
              </dd>
              <dt className="text-muted-foreground">Counted</dt>
              <dd className="tabular text-right">{formatMoney(day.closing.countedCashPaise)}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              Signed off {formatDateTime(day.closing.closedAt)}
              {day.closing.notes ? ` · ${day.closing.notes}` : ''}
            </p>
            {canVoid ? (
              <CloseDayPanel
                mode="reopen"
                branchId={branchId}
                businessDate={businessDate}
                closingId={day.closing.id}
                expectedPaise={day.expectedCashPaise.toString()}
                methods={[]}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : canClose ? (
        <CloseDayPanel
          mode="close"
          branchId={branchId}
          businessDate={businessDate}
          expectedPaise={day.expectedCashPaise.toString()}
          methods={day.methodTotals
            .filter((m) => !m.affectsCashDrawer)
            .map((m) => ({
              id: m.paymentMethodId,
              name: m.methodName,
              expectedPaise: m.expectedPaise.toString(),
            }))}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            This day has not been closed. You can see it, but closing is a manager&rsquo;s job.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
