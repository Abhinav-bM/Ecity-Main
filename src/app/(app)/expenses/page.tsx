import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pagination } from '@/components/pagination'
import { formatMoney } from '@/lib/money'
import { formatDateShort, formatTimeShort } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listExpenses } from '@/server/services/expense.service'
import { VoidExpenseButton } from './void-expense'

export const dynamic = 'force-dynamic'

/*
 * A business date is a plain calendar day with no time in it. Reading it at
 * midday sidesteps the question of whose midnight it was, so the day printed
 * is the day stored no matter where this renders.
 */
function expenseDay(businessDate: string): string {
  return formatDateShort(`${businessDate}T12:00:00Z`)
}

const PAGE_SIZE = 25

/** PRD FR-10.1 – FR-10.3. What the shop spent. */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'expense.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const canRecord = hasPermission(session.user, 'expense.manage')
  const canVoid = hasPermission(session.user, 'expense.void')

  const { rows, total, totalPaise } = await listExpenses(session.user, {
    from: p.from,
    to: p.to,
    includeVoided: p.includeVoided === '1',
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Money out. A cash expense leaves the branch drawer; anything else leaves an account.
          </p>
        </div>
        {canRecord ? (
          <Button asChild size="sm">
            <Link href="/expenses/new">Record an expense</Link>
          </Button>
        ) : null}
      </div>

      <Card className="p-4">
        {/* Over everything in the filter, not just this page. */}
        <p className="text-xs text-muted-foreground">Total spent</p>
        <p className="tabular text-2xl font-semibold">{formatMoney(totalPaise)}</p>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing recorded yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="expense-cards">
            {rows.map((e) => (
              <Card key={e.id} data-testid="expense-row">
                <CardContent className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/expenses/${e.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {e.categoryName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {expenseDay(e.businessDate)} {formatTimeShort(e.createdAt)} ·{' '}
                        {e.branchName} · {e.methodName}
                      </p>
                    </div>
                    <p className="tabular font-semibold">{formatMoney(e.amountPaise)}</p>
                  </div>
                  {e.description ? (
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {e.voidedAt ? <Badge variant="destructive">VOIDED</Badge> : null}
                    {e.postedAfterClose ? <Badge variant="warning">After close</Badge> : null}
                    {canVoid && !e.voidedAt ? (
                      <VoidExpenseButton id={e.id} amount={formatMoney(e.amountPaise)} />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canVoid ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} data-testid="expense-row">
                    <TableCell className="whitespace-nowrap">
                      {expenseDay(e.businessDate)}
                      <span className="block text-xs text-muted-foreground">
                        {formatTimeShort(e.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/expenses/${e.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {e.categoryName}
                      </Link>
                      {e.description ? (
                        <span className="block text-xs text-muted-foreground">{e.description}</span>
                      ) : null}
                      <span className="flex gap-1.5">
                        {e.voidedAt ? <Badge variant="destructive">VOIDED</Badge> : null}
                        {e.postedAfterClose ? <Badge variant="warning">After close</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.branchName}</TableCell>
                    <TableCell className="text-muted-foreground">{e.methodName}</TableCell>
                    <TableCell className="text-muted-foreground">{e.recordedBy ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatMoney(e.amountPaise)}
                    </TableCell>
                    {canVoid ? (
                      <TableCell className="text-right">
                        {e.voidedAt ? null : (
                          <VoidExpenseButton id={e.id} amount={formatMoney(e.amountPaise)} />
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/expenses"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="expenses"
          />
        </>
      )}
    </div>
  )
}
