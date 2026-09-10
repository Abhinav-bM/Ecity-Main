import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getDrawerDay } from '@/server/services/cash.service'
import { listBranches } from '@/server/services/branch.service'
import { DrawerControls } from './drawer-controls'
import { shopDayParam } from '@/lib/date'

export const dynamic = 'force-dynamic'

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening',
  SALE: 'Sale',
  CUSTOMER_PAYMENT: 'Collection',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  SUPPLIER_PAYMENT: 'Supplier payment',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  ADJUSTMENT: 'Adjustment',
}

/** PRD FR-11.1 – FR-11.5. One branch's till for one day. */
export default async function CashDrawerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'cash.view')) redirect('/dashboard')

  const p = await searchParams
  const branches = await listBranches(session.user)
  const branchId = Number(p.branchId ?? session.activeBranchId ?? branches[0]?.id ?? 0)
  if (!branchId) {
    return <p className="p-6 text-sm text-muted-foreground">No branch to show.</p>
  }

  // From the address bar, so anything that is not a real day becomes today.
  const businessDate = shopDayParam(p.date)
  const day = await getDrawerDay(session.user, branchId, businessDate)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Cash drawer</h1>
        <p className="text-sm text-muted-foreground">
          {day.branchName} · {businessDate}. Expected cash is the opening balance plus every
          movement below — it is never a stored figure.
        </p>
      </div>

      <DrawerControls
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        branchId={branchId}
        date={businessDate}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Opening</p>
          <p className="tabular text-xl font-semibold">{formatMoney(day.openingPaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Cash in</p>
          <p className="tabular text-xl font-semibold text-success">
            {formatMoney(day.inPaise)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Cash out</p>
          <p className="tabular text-xl font-semibold text-destructive">
            {formatMoney(day.outPaise)}
          </p>
        </Card>
        <Card className="p-4" data-testid="expected-cash">
          <p className="text-xs text-muted-foreground">Expected in the till</p>
          <p className="tabular text-xl font-semibold">{formatMoney(day.expectedPaise)}</p>
          <Badge variant={day.status === 'CLOSED' ? 'secondary' : 'success'} className="mt-1">
            {day.status}
          </Badge>
        </Card>
      </div>

      {day.movements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No cash has moved on this day yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="movement-cards">
            {day.movements.map((m) => (
              <Card key={m.id} data-testid="movement-row">
                <CardContent className="flex items-start justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{MOVEMENT_LABEL[m.movement] ?? m.movement}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(m.occurredAt)}
                      {m.note ? ` · ${m.note}` : ''}
                    </p>
                    {m.postedAfterClose ? (
                      <Badge variant="warning" className="mt-1">
                        After close
                      </Badge>
                    ) : null}
                  </div>
                  <p
                    className={`tabular font-semibold ${
                      m.amountPaise < 0n ? 'text-destructive' : 'text-success'
                    }`}
                  >
                    {m.amountPaise < 0n ? '−' : '+'}
                    {formatMoney(m.amountPaise < 0n ? -m.amountPaise : m.amountPaise)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.movements.map((m) => (
                  <TableRow key={m.id} data-testid="movement-row">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.occurredAt)}
                    </TableCell>
                    <TableCell>
                      {MOVEMENT_LABEL[m.movement] ?? m.movement}
                      {m.postedAfterClose ? (
                        <Badge variant="warning" className="ml-1.5">
                          After close
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.note ?? '—'}</TableCell>
                    <TableCell className="tabular text-right text-success">
                      {m.amountPaise > 0n ? formatMoney(m.amountPaise) : ''}
                    </TableCell>
                    <TableCell className="tabular text-right text-destructive">
                      {m.amountPaise < 0n ? formatMoney(-m.amountPaise) : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
