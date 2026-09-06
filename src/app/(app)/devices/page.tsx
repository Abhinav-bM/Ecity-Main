import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listDevices, mainTypeSummary } from '@/server/services/device.service'
import { listBrands, listCategories } from '@/server/services/product.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { listParties } from '@/server/services/party.service'
import { DeviceList } from './device-list'
import type { MainType } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const filters = {
    search: p.search ?? '',
    mainType: p.mainType as MainType | undefined,
    globalVariant: p.globalVariant as 'NEW_CUT' | 'PLAIN' | undefined,
    status: p.status as never,
    supplierId: p.supplierId ? Number(p.supplierId) : undefined,
    brandId: p.brandId ? Number(p.brandId) : undefined,
    categoryId: p.categoryId ? Number(p.categoryId) : undefined,
    branchId: p.branchId ? Number(p.branchId) : undefined,
    page,
    pageSize: PAGE_SIZE,
  }

  const [devices, summary, brands, categories, branches, suppliers] = await Promise.all([
    listDevices(session.user, filters),
    mainTypeSummary(session.user, filters.branchId ?? session.activeBranchId),
    listBrands(session.user),
    listCategories(session.user),
    listAccessibleBranches(session.user),
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
  ])

  return (
    <DeviceList
      rows={devices.rows}
      total={devices.total}
      page={page}
      pageSize={PAGE_SIZE}
      summary={summary}
      brands={brands}
      categories={categories}
      branches={branches}
      suppliers={suppliers.rows.map((r) => ({ id: r.id, name: r.name }))}
      filters={filters}
      canManage={hasPermission(session.user, 'device.manage')}
      showCost={hasPermission(session.user, 'inventory.view_cost')}
    />
  )
}
