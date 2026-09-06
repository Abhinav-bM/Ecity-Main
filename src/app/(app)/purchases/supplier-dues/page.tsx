import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Pagination } from '@/components/pagination'
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
import { supplierOutstanding } from '@/server/services/supplier-ledger.service'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

/** PRD FR-14.3 — supplier-wise outstanding. Suppliers are shared across branches. */
export default async function SupplierOutstandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier_payment.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const dues = await supplierOutstanding(session.user, page, PAGE_SIZE)
  const rows = dues.rows
  // Owed across every supplier, not just the ones on this page.
  const totalOwed = dues.totalOwedPaise > 0n ? dues.totalOwedPaise : 0n

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Supplier dues</h1>
        <p className="text-sm text-muted-foreground">
          What the business owes, across every branch. Balances are the sum of the ledger, never a
          stored figure.
        </p>
      </div>

      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Total owed</p>
        <p className="tabular text-2xl font-semibold">{formatMoney(totalOwed)}</p>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No supplier activity yet.
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="outstanding-cards">
            {rows.map((r) => (
              <Card key={r.supplierId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/suppliers/${r.supplierId}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {r.supplierName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.purchaseCount} purchase{r.purchaseCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span
                    className={`tabular font-medium ${r.balancePaise > 0n ? '' : 'text-muted-foreground'}`}
                  >
                    {formatMoney(r.balancePaise)}
                  </span>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="outstanding-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden lg:table-cell">Company</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="hidden xl:table-cell">Last purchase</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplierId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/suppliers/${r.supplierId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {r.company ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{r.phone ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">{r.purchaseCount}</TableCell>
                    <TableCell className="hidden whitespace-nowrap xl:table-cell">
                      {r.lastPurchaseAt ? formatDateShort(r.lastPurchaseAt) : '—'}
                    </TableCell>
                    <TableCell
                      className={`tabular text-right font-medium ${r.balancePaise > 0n ? '' : 'text-muted-foreground'}`}
                    >
                      {formatMoney(r.balancePaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Pagination
        basePath="/purchases/supplier-dues"
        params={p}
        page={dues.page}
        pageSize={dues.pageSize}
        total={dues.total}
        noun="suppliers"
      />
    </div>
  )
}
