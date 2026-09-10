import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { PurchaseForm } from './purchase-form'

export const dynamic = 'force-dynamic'

export default async function NewPurchasePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.manage')) redirect('/purchases')

  // Products and suppliers are searched from their pickers rather than loaded
  // up front, so neither list can outgrow a fixed page size.
  const branches = await listAccessibleBranches(session.user)

  return (
    <PurchaseForm
      branches={branches}
      canCreateProduct={hasPermission(session.user, 'product.manage')}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
    />
  )
}
