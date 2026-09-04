import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listTaxRates } from '@/server/services/business.service'
import { listBrands, listCategories } from '@/server/services/product.service'
import { listParties } from '@/server/services/party.service'
import { ProductForm } from '../product-form'

export const dynamic = 'force-dynamic'

export default async function NewProductPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.manage')) redirect('/products')

  const [categories, brands, taxRates, suppliers] = await Promise.all([
    listCategories(session.user),
    listBrands(session.user),
    listTaxRates(session.user),
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
  ])

  return (
    <ProductForm
      categories={categories.map((c) => ({ id: c.id, name: c.name, isSerialised: c.isSerialised }))}
      brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      taxRates={taxRates.map((t) => ({ id: t.id, name: t.name }))}
      suppliers={suppliers.rows.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
