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
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listProducts } from '@/server/services/product.service'
import { ProductFilters } from './product-filters'

export const dynamic = 'force-dynamic'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.view')) redirect('/dashboard')

  const p = await searchParams
  const search = p.search ?? ''
  const { rows, total } = await listProducts(session.user, {
    search,
    serialised: p.kind === 'mobile' ? true : p.kind === 'accessory' ? false : undefined,
    includeInactive: p.includeInactive === '1',
    page: Math.max(1, Number(p.page ?? '1') || 1),
    pageSize: 25,
  })

  const canManage = hasPermission(session.user, 'product.manage')
  const showCost = hasPermission(session.user, 'inventory.view_cost')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Products</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} in the catalogue. Quantities are summed across the
            branches you can see.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href="/products/new">Add product</Link>
          </Button>
        ) : null}
      </div>

      <ProductFilters search={search} kind={p.kind ?? ''} includeInactive={p.includeInactive === '1'} />

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {search ? `No products match “${search}”.` : 'No products yet.'}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="product-cards">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${r.id}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.brandName, r.categoryName].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {r.isSerialised ? <Badge variant="outline">IMEI</Badge> : null}
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {r.isSerialised ? 'Tracked by IMEI' : `${r.quantity} in stock`}
                  </span>
                  <span className="tabular">{formatMoney(r.sellingPricePaise)}</span>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="product-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden lg:table-cell">SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="hidden xl:table-cell">Brand</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  {showCost ? <TableHead className="text-right">Cost</TableHead> : null}
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link href={`/products/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                      {!r.isActive ? (
                        <Badge variant="muted" className="ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {r.sku ?? '—'}
                    </TableCell>
                    <TableCell>{r.categoryName}</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.brandName ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">
                      {r.isSerialised ? (
                        <span className="text-xs text-muted-foreground">by IMEI</span>
                      ) : (
                        r.quantity
                      )}
                    </TableCell>
                    {showCost ? (
                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatMoney(r.purchasePricePaise)}
                      </TableCell>
                    ) : null}
                    <TableCell className="tabular text-right">
                      {formatMoney(r.sellingPricePaise)}
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
