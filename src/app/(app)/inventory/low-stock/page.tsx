import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
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
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listLowStock, LOW_STOCK_SORTS } from '@/server/services/product.service'
import { readListView } from '@/lib/list-view'
import { Pagination } from '@/components/pagination'
import { SortableHead, SortStrip } from '@/components/sortable-head'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-4.7 — products at or below their minimum for a branch.
 *
 * Counted stock only. A serialised product has no branch minimum: you do not
 * reorder "3 more iPhone 15s" the way you reorder cables, and M10's dead-stock
 * and turnover reports are the right lens for handsets.
 */
const PAGE_SIZE = 25

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const p = await searchParams
  // Shortfall first: what is furthest below its minimum is what to reorder
  // first, and alphabetical order would bury it.
  const view = readListView(p, LOW_STOCK_SORTS, { sort: 'shortfall', dir: 'desc' })
  const { rows, total } = await listLowStock(session.user, session.activeBranchId, {
    page: view.page,
    pageSize: PAGE_SIZE,
    sort: view.sort,
    dir: view.dir,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Low stock</h1>
        <p className="text-sm text-muted-foreground">
          Accessories at or below the minimum set for their branch. Set a minimum on a product to
          have it watched here.
        </p>
      </div>

      {total === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium">Nothing is running low.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Either every counted product is above its minimum, or no minimums have been set yet.
          </p>
        </Card>
      ) : (
        <>
          <SortStrip
            basePath="/inventory/low-stock"
            params={p}
            columns={[
              ['shortfall', 'Short by'],
              ['product', 'Product'],
              ['branch', 'Branch'],
              ['quantity', 'In stock'],
              ['minimum', 'Minimum'],
            ]}
            active={view.sort}
            dir={view.dir}
            className="md:hidden"
          />
          <div className="grid gap-3 md:hidden" data-testid="low-stock-cards">
            {rows.map((r) => (
              <Card key={`${r.productId}:${r.branchId}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${r.productId}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {r.productName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.branchName}</p>
                  </div>
                  <Badge variant={r.quantity === 0 ? 'destructive' : 'warning'}>
                    {r.quantity === 0 ? 'Out of stock' : `${r.quantity} left`}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Minimum {r.minQuantity} · short by {Math.max(0, r.minQuantity - r.quantity)}
                </p>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="low-stock-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    basePath="/inventory/low-stock"
                    params={p}
                    column="product"
                    label="Product"
                    active={view.sort}
                    dir={view.dir}
                  />
                  {/* SKU is optional on a product, so there is little to sort by. */}
                  <TableHead className="hidden lg:table-cell">SKU</TableHead>
                  <SortableHead
                    basePath="/inventory/low-stock"
                    params={p}
                    column="branch"
                    label="Branch"
                    active={view.sort}
                    dir={view.dir}
                  />
                  {(
                    [
                      ['quantity', 'In stock'],
                      ['minimum', 'Minimum'],
                      ['shortfall', 'Short by'],
                    ] as const
                  ).map(([column, label]) => (
                    <SortableHead
                      key={column}
                      basePath="/inventory/low-stock"
                      params={p}
                      column={column}
                      label={label}
                      active={view.sort}
                      dir={view.dir}
                      align="right"
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.productId}:${r.branchId}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/products/${r.productId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.productName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {r.sku ?? '—'}
                    </TableCell>
                    <TableCell>{r.branchName}</TableCell>
                    <TableCell className="tabular text-right">
                      {r.quantity === 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-destructive">
                          <AlertTriangle className="size-3.5" />0
                        </span>
                      ) : (
                        r.quantity
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {r.minQuantity}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {Math.max(0, r.minQuantity - r.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/inventory/low-stock"
            params={p}
            page={view.page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="products"
          />
        </>
      )}
    </div>
  )
}
