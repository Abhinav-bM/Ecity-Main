import Link from 'next/link'
import { parseShopDate, parseShopDateEnd } from '@/lib/date'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { AGING_BUCKETS, branchDues, customerDues } from '@/server/services/customer-ledger.service'
import { Pagination } from '@/components/pagination'
import { formatMoney } from '@/lib/money'
import { DuesFilters } from './dues-filters'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const BUCKET_LABEL: Record<string, string> = {
  '0-7': '0–7 days',
  '8-30': '8–30 days',
  '31-60': '31–60 days',
  '60+': '60+ days',
}

/** PRD FR-7.6 — who owes what, how old it is, and what is already late. */
export default async function CustomerDuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer_payment.view')) redirect('/dashboard')

  const p = await searchParams
  const canCollect = hasPermission(session.user, 'customer_payment.manage')

  // Collections need a window to be a meaningful figure. Default to the
  // current month, which is the period a shop actually reviews.
  const now = new Date()
  const from = parseShopDate(p.from) ?? new Date(now.getFullYear(), now.getMonth(), 1)
  const to = parseShopDateEnd(p.to) ?? new Date(now.getTime() + 86_400_000)

  const [dues, byBranch, branches] = await Promise.all([
    customerDues(session.user, {
      branchId: p.branchId ? Number(p.branchId) : null,
      overdueOnly: p.overdue === '1',
      search: p.search,
      page: Math.max(1, Number(p.page ?? '1') || 1),
      pageSize: PAGE_SIZE,
    }),
    branchDues(session.user, { from, to }, now),
    listAccessibleBranches(session.user),
  ])

  const overdueTotal = dues.rows.reduce((sum, r) => sum + r.overduePaise, 0n)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Customer dues</h1>
        <p className="text-sm text-muted-foreground">
          Every balance is summed from the ledger, never a stored figure.
        </p>
      </div>

      <DuesFilters branches={branches} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">
              Total outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-2xl font-semibold">{formatMoney(dues.totalPaise)}</p>
            <p className="text-xs text-muted-foreground">
              {dues.rows.length} customer{dues.rows.length === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`tabular text-2xl font-semibold ${overdueTotal > 0n ? 'text-destructive' : ''}`}
            >
              {formatMoney(overdueTotal)}
            </p>
            <p className="text-xs text-muted-foreground">Past the agreed date</p>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">By age</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
              {AGING_BUCKETS.map((b) => (
                <div key={b} className="col-span-2 flex justify-between gap-2">
                  <dt className="text-muted-foreground">{BUCKET_LABEL[b]}</dt>
                  <dd className="tabular">{formatMoney(dues.totals[b])}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/*
        PRD FR-7.6 branch-wise. The two columns deliberately need not match:
        a customer can buy at one shop and settle at another, so the debt sits
        with the branch that raised the bill while the cash lands where it was
        taken.
      */}
      {byBranch.rows.length > 1 ? (
        <Card data-testid="branch-dues">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By branch</CardTitle>
            <p className="text-xs text-muted-foreground">
              Owed on each branch&apos;s own bills; collected wherever the money was taken
              {p.from || p.to ? '' : ' this month'}.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byBranch.rows.map((b) => (
                    <TableRow key={b.branchId}>
                      <TableCell>
                        {b.branchName}
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          {b.branchCode}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">{b.openInvoiceCount}</TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {formatMoney(b.outstandingPaise)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {b.overduePaise > 0n ? (
                          <span className="text-destructive">{formatMoney(b.overduePaise)}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatMoney(b.collectedPaise)}
                      </TableCell>
                      <TableCell className="tabular text-right">{b.receiptCount}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell>All branches</TableCell>
                    <TableCell />
                    <TableCell className="tabular text-right">
                      {formatMoney(byBranch.totalOutstandingPaise)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="tabular text-right">
                      {formatMoney(byBranch.totalCollectedPaise)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dues.rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {p.overdue === '1' ? 'Nothing is overdue.' : 'Nobody owes anything.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cards on a phone; the aging grid needs a real table to be read. */}
          <div className="grid gap-3 md:hidden" data-testid="dues-cards">
            {dues.rows.map((r) => (
              <Card key={r.customerId} data-testid="dues-row">
                <CardContent className="space-y-2 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/customers/${r.customerId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {r.customerName}
                      </Link>
                      {r.phone ? (
                        <p className="font-mono text-xs text-muted-foreground">{r.phone}</p>
                      ) : null}
                    </div>
                    <p className="tabular shrink-0 font-semibold">
                      {formatMoney(r.balancePaise)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {AGING_BUCKETS.filter((b) => r.buckets[b] > 0n).map((b) => (
                      <Badge key={b} variant={b === '60+' ? 'destructive' : 'muted'}>
                        {BUCKET_LABEL[b]}: {formatMoney(r.buckets[b])}
                      </Badge>
                    ))}
                  </div>
                  {canCollect ? (
                    <Button size="lg" variant="outline" asChild className="w-full">
                      <Link href={`/customers/${r.customerId}/collect`}>Collect</Link>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="dues-table">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    {AGING_BUCKETS.map((b) => (
                      <TableHead key={b} className="text-right whitespace-nowrap">
                        {BUCKET_LABEL[b]}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    {canCollect ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dues.rows.map((r) => (
                    <TableRow key={r.customerId} data-testid="dues-row">
                      <TableCell>
                        <Link
                          href={`/customers/${r.customerId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.customerName}
                        </Link>
                        {r.phone ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {r.phone}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right">{r.openInvoiceCount}</TableCell>
                      {AGING_BUCKETS.map((b) => (
                        <TableCell key={b} className="tabular text-right">
                          {r.buckets[b] > 0n ? formatMoney(r.buckets[b]) : '—'}
                        </TableCell>
                      ))}
                      <TableCell className="tabular text-right font-medium">
                        {formatMoney(r.balancePaise)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {r.overduePaise > 0n ? (
                          <span className="font-medium text-destructive">
                            {formatMoney(r.overduePaise)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      {canCollect ? (
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/customers/${r.customerId}/collect`}>Collect</Link>
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      <Pagination
        basePath="/customers/dues"
        params={p}
        page={dues.page}
        pageSize={dues.pageSize}
        total={dues.total}
        noun="customers"
      />

      <p className="text-xs text-muted-foreground">
        Ages run from the agreed due date, or the sale date where none was set.
        The totals above cover every debtor, not just this page.
      </p>
    </div>
  )
}
