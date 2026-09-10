import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { reconciliationReport } from '@/server/services/closing.service'
import { shopDayParam } from '@/lib/date'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-13.5. Every branch's day side by side.
 *
 * Recomputed from the movements rather than read off the closings, so a branch
 * that has not closed yet still appears with its expected figure - which is
 * the whole point of a consolidated view at the end of the day.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'closing.view')) redirect('/dashboard')

  const p = await searchParams
  // From the address bar, so anything that is not a real day becomes today.
  const businessDate = shopDayParam(p.date)
  const report = await reconciliationReport(session.user, businessDate)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Reconciliation — {businessDate}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every branch you can see. A branch that has not closed yet still shows what it should
          have.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Sales</p>
          <p className="tabular text-xl font-semibold">{formatMoney(report.totals.salesPaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Expected cash</p>
          <p className="tabular text-xl font-semibold">
            {formatMoney(report.totals.expectedCashPaise)}
          </p>
        </Card>
        <Card className="p-4" data-testid="consolidated-difference">
          <p className="text-xs text-muted-foreground">Difference</p>
          <p
            className={`tabular text-xl font-semibold ${
              report.totals.differencePaise < 0n ? 'text-destructive' : ''
            }`}
          >
            {formatMoney(report.totals.differencePaise)}
          </p>
          <p className="text-xs text-muted-foreground">
            {report.allClosed ? 'Every branch has closed' : 'Some branches are still open'}
          </p>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.days.map((d) => (
              <TableRow key={d.branchId} data-testid="reconciliation-row">
                <TableCell>
                  {d.branchName}
                  {d.closing ? null : (
                    <Badge variant="secondary" className="ml-1.5">
                      Open
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{formatMoney(d.salesPaise)}</TableCell>
                <TableCell className="tabular text-right">
                  {formatMoney(d.expensesPaise)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatMoney(d.expectedCashPaise)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {d.closing ? formatMoney(d.closing.countedCashPaise) : '—'}
                </TableCell>
                <TableCell className="tabular text-right">
                  {d.closing ? formatMoney(d.closing.cashDifferencePaise) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
