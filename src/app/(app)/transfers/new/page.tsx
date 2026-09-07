import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listBranches } from '@/server/services/branch.service'
import { TransferForm } from './transfer-form'

export const dynamic = 'force-dynamic'

export default async function NewTransferPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'transfer.request')) redirect('/transfers')

  const branches = await listBranches(session.user)
  if (branches.length < 2) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        A transfer needs two branches. Add another under Settings → Branches.
      </p>
    )
  }

  return (
    <TransferForm
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultFromId={session.activeBranchId ?? branches[0]!.id}
    />
  )
}
