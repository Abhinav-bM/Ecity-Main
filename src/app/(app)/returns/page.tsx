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
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listReturns } from '@/server/services/return.service'
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
import { readPage } from '@/lib/list-view'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'return.view')) redirect('/dashboard')

  const p = await searchParams
  const page = readPage(p.page)
  const { rows, total } = await listReturns(session.user, {
    search: p.search,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Returns</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} recorded.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/returns/inspection">Inspection queue</Link>
          </Button>
          {hasPermission(session.user, 'return.create') ? (
            <Button asChild>
              <Link href="/returns/new">Take a return</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing has been returned yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="return-cards">
            {rows.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/returns/${r.id}`}
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {r.returnNumber}
                    </Link>
                    <Badge variant={r.voidedAt ? 'destructive' : 'muted'}>
                      {r.voidedAt ? 'Voided' : r.returnType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDateShort(r.returnedAt)} · {r.customerName ?? 'Walk-in'} · {r.branchName}
                  </p>
                  <p className="tabular font-medium">{formatMoney(r.totalPaise)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="return-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead>Against</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/returns/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.returnNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/sales/${r.saleId}`} className="underline-offset-4 hover:underline">
                        {r.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateShort(r.returnedAt)}
                    </TableCell>
                    <TableCell>{r.customerName ?? 'Walk-in'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.branchName}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(r.totalPaise)}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatMoney(r.refundedPaise)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.voidedAt ? 'destructive' : 'muted'}>
                        {r.voidedAt ? 'Voided' : r.returnType}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/returns"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="returns"
          />
        </>
      )}
    </div>
  )
}
