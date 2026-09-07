import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getBusiness } from '@/server/services/business.service'
import { listUsers } from '@/server/services/user.service'
import { BranchForm } from '../branch-form'

export const dynamic = 'force-dynamic'

export default async function NewBranchPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'branch.manage')) redirect('/settings/branches')

  const [users, business] = await Promise.all([
    listUsers(session.user),
    getBusiness(session.user),
  ])
  return (
    <BranchForm
      managers={users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name }))}
      gstEnabled={business.gstEnabled}
    />
  )
}
