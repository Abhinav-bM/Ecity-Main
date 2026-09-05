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
import { listLowStock } from '@/server/services/product.service'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-4.7 — products at or below their minimum for a branch.
 *
 * Counted stock only. A serialised product has no branch minimum: you do not
 * reorder "3 more iPhone 15s" the way you reorder cables, and M10's dead-stock
 * and turnover reports are the right lens for handsets.
 */
export default async function LowStockPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const rows = await listLowStock(session.user, session.activeBranchId)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Low stock</h1>
        <p className="text-sm text-muted-foreground">
          Accessories at or below the minimum set for their branch. Set a minimum on a product to
          have it watched here.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium">Nothing is running low.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Either every counted product is above its minimum, or no minimums have been set yet.
          </p>
        </Card>
      ) : (
        <>
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
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden lg:table-cell">SKU</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead className="text-right">Short by</TableHead>
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
        </>
      )}
    </div>
  )
}
