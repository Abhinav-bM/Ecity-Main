import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  listBrands,
  listCategories,
  masterDataUsage,
} from '@/server/services/product.service'
import { CatalogueManager } from './catalogue-manager'

export const dynamic = 'force-dynamic'

/**
 * Brands and categories (carried into M11 from M5).
 *
 * The API and permissions existed from M2 and the seed filled both lists, so
 * the pickers worked and nobody noticed there was no way to add a sixteenth
 * brand. A shop taking on a new one hit a wall.
 */
export default async function CataloguePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.manage')) redirect('/products')

  const [brands, categories, usage] = await Promise.all([
    listBrands(session.user),
    listCategories(session.user),
    masterDataUsage(session.user),
  ])

  return (
    <CatalogueManager
      brands={brands.map((b) => ({
        id: b.id,
        name: b.name,
        isActive: b.isActive,
        productCount: usage.byBrand.get(b.id) ?? 0,
      }))}
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        isSerialised: c.isSerialised,
        identifierType: c.identifierType,
        productCount: usage.byCategory.get(c.id) ?? 0,
      }))}
    />
  )
}
