import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listParties } from '@/server/services/party.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { PurchaseForm } from './purchase-form'

export const dynamic = 'force-dynamic'

export default async function NewPurchasePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.manage')) redirect('/purchases')

  // Products are searched from the picker rather than loaded up front, so the
  // catalogue can grow past any fixed page size.
  const [suppliers, branches] = await Promise.all([
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
    listAccessibleBranches(session.user),
  ])

  return (
    <PurchaseForm
      suppliers={suppliers.rows.map((s) => ({ id: s.id, name: s.name }))}
      branches={branches}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
    />
  )
}
