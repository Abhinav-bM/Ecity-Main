import { notFound, redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listTaxRates } from '@/server/services/business.service'
import { getProduct, listBrands, listCategories } from '@/server/services/product.service'
import { listParties } from '@/server/services/party.service'
import { paiseToRupees } from '@/lib/validation'
import { ProductForm } from '../product-form'

export const dynamic = 'force-dynamic'

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [detail, categories, brands, taxRates, suppliers] = await Promise.all([
    getProduct(session.user, id),
    listCategories(session.user),
    listBrands(session.user),
    listTaxRates(session.user),
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
  ])

  const p = detail.product

  return (
    <div className="space-y-4">
      {hasPermission(session.user, 'product.manage') ? (
        <ProductForm
          id={id}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            isSerialised: c.isSerialised,
            identifierType: c.identifierType,
          }))}
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          taxRates={taxRates.map((t) => ({ id: t.id, name: t.name }))}
          suppliers={suppliers.rows.map((s) => ({ id: s.id, name: s.name }))}
          initial={{
            name: p.name,
            categoryId: p.categoryId,
            brandId: p.brandId,
            model: p.model ?? '',
            sku: p.sku ?? '',
            barcode: p.barcode ?? '',
            description: p.description ?? '',
            purchasePrice: p.defaultPurchasePricePaise
              ? paiseToRupees(p.defaultPurchasePricePaise)
              : '',
            sellingPrice: p.defaultSellingPricePaise
              ? paiseToRupees(p.defaultSellingPricePaise)
              : '',
            taxRateId: p.taxRateId,
            defaultSupplierId: p.defaultSupplierId,
          }}
        />
      ) : (
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{p.name}</h1>
      )}

      <Card className="mx-auto max-w-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Stock by branch</CardTitle>
            <CardDescription>
              Stock always belongs to a branch, never the business.
              {p.isSerialised
                ? ' For an IMEI- or serial-tracked product this is the number of units still in stock.'
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.stock.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock recorded yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {detail.stock.map((s) => (
                  <li key={s.branchId} className="flex items-center gap-3 p-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{s.branchCode}</span>
                    <span className="min-w-0 flex-1 truncate">{s.branchName}</span>
                    <span className="tabular font-medium">{s.quantity}</span>
                    {s.minQuantity > 0 ? (
                      <span className="text-xs text-muted-foreground">min {s.minQuantity}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
