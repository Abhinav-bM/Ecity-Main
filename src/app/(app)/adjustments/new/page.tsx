import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listBranches } from '@/server/services/branch.service'
import { AdjustmentForm } from './adjustment-form'

export const dynamic = 'force-dynamic'

export default async function NewAdjustmentPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'adjustment.create')) redirect('/adjustments')

  const branches = await listBranches(session.user)

  return (
    <AdjustmentForm
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
    />
  )
}
