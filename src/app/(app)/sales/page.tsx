import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Pagination } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateShort } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listSales } from '@/server/services/sale.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { SaleFilters } from './sale-filters'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'destructive' } as const

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'sale.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  // An inclusive "to" date means the whole of that day, so the range ends at
  // midnight following it.
  const toExclusive = p.to ? new Date(`${p.to}T00:00:00`) : undefined
  if (toExclusive) toExclusive.setDate(toExclusive.getDate() + 1)

  const [{ rows, total }, branches] = await Promise.all([
    listSales(session.user, {
      search: p.search,
      paymentStatus: p.paymentStatus as never,
      branchId: p.branchId ? Number(p.branchId) : undefined,
      from: p.from ? new Date(`${p.from}T00:00:00`) : undefined,
      to: toExclusive,
      page,
      pageSize: PAGE_SIZE,
    }),
    listAccessibleBranches(session.user),
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Sales</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} invoices.
          </p>
        </div>
        {hasPermission(session.user, 'sale.create') ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href="/billing">New bill</Link>
          </Button>
        ) : null}
      </div>

      <SaleFilters
        search={p.search ?? ''}
        paymentStatus={p.paymentStatus ?? ''}
        branchId={p.branchId ?? ''}
        from={p.from ?? ''}
        to={p.to ?? ''}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      />

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium">No sales yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The billing screen is where a bill is made.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="sale-cards">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/sales/${r.id}`}
                      className="font-mono text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {r.invoiceNumber}
                    </Link>
                    <p className="truncate text-sm text-muted-foreground">
                      {r.customerName ?? 'Walk-in'}
                    </p>
                  </div>
                  <Badge variant={PAY_VARIANT[r.paymentStatus]}>{r.paymentStatus}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {formatDateShort(r.soldAt)} · {r.branchCode}
                  </span>
                  <span className="tabular font-medium">{formatMoney(r.totalPaise)}</span>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="sale-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Branch</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/sales/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateShort(r.soldAt)}</TableCell>
                    <TableCell>{r.customerName ?? 'Walk-in'}</TableCell>
                    <TableCell className="hidden lg:table-cell">{r.branchName}</TableCell>
                    <TableCell className="tabular text-right">{r.itemCount}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(r.totalPaise)}</TableCell>
                    <TableCell>
                      <Badge variant={PAY_VARIANT[r.paymentStatus]}>{r.paymentStatus}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/sales"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="invoices"
          />
        </>
      )}
    </div>
  )
}
