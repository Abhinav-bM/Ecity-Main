import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getBusiness, listTaxRates } from '@/server/services/business.service'
import { listProducts } from '@/server/services/product.service'
import { listParties } from '@/server/services/party.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { DeviceForm } from './device-form'

export const dynamic = 'force-dynamic'

export default async function NewDevicePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'device.manage')) redirect('/devices')

  const [business, products, suppliers, branches, taxRates] = await Promise.all([
    getBusiness(session.user),
    // The picker searches on demand, so the page only needs to know whether
    // any serialised product exists at all.
    listProducts(session.user, { serialised: true, page: 1, pageSize: 1 }),
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
    listAccessibleBranches(session.user),
    listTaxRates(session.user),
  ])

  return (
    <DeviceForm
      // FR-4.11: the setting controls how many IMEI inputs appear, and
      // nothing else. The request body is always a list.
      imeiSlots={business.imeiSlots}
      hasProducts={products.total > 0}
      suppliers={suppliers.rows.map((s) => ({ id: s.id, name: s.name }))}
      branches={branches}
      taxRates={taxRates.map((t) => ({ id: t.id, name: t.name }))}
      gstEnabled={business.gstEnabled}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
    />
  )
}
