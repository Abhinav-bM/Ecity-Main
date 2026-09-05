import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { listPurchases } from '@/server/services/purchase.service'

export const dynamic = 'force-dynamic'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'muted' } as const

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.view')) redirect('/dashboard')

  const p = await searchParams
  const { rows, total } = await listPurchases(session.user, {
    search: p.search,
    status: p.status as never,
    page: Math.max(1, Number(p.page ?? '1') || 1),
    pageSize: 25,
  })
  const canManage = hasPermission(session.user, 'purchase.manage')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Purchases</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} recorded. Confirming a purchase is what brings stock in.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href="/purchases/new">Record purchase</Link>
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium">No purchases yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Recording one raises stock, registers each unit and posts what you owe the supplier.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="purchase-cards">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/purchases/${r.id}`}
                      className="font-mono text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {r.purchaseNumber}
                    </Link>
                    <p className="truncate text-sm text-muted-foreground">{r.supplierName}</p>
                  </div>
                  <Badge variant={r.status === 'REVERSED' ? 'destructive' : PAY_VARIANT[r.paymentStatus]}>
                    {r.status === 'REVERSED' ? 'Reversed' : r.paymentStatus}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {formatDateShort(r.purchaseDate)} · {r.branchCode}
                  </span>
                  <span className="tabular font-medium">{formatMoney(r.totalPaise)}</span>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="purchase-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden lg:table-cell">Branch</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/purchases/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.purchaseNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateShort(r.purchaseDate)}
                    </TableCell>
                    <TableCell className="font-medium">{r.supplierName}</TableCell>
                    <TableCell className="hidden lg:table-cell">{r.branchName}</TableCell>
                    <TableCell className="tabular text-right">{r.lineCount}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(r.totalPaise)}</TableCell>
                    <TableCell>
                      {r.status === 'REVERSED' ? (
                        <Badge variant="destructive">Reversed</Badge>
                      ) : (
                        <Badge variant={PAY_VARIANT[r.paymentStatus]}>{r.paymentStatus}</Badge>
                      )}
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
