import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listRoles } from '@/server/services/role.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { NewUserForm } from './new-user-form'

export const dynamic = 'force-dynamic'

export default async function NewUserPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'user.manage')) redirect('/settings/users')

  const [roles, branches] = await Promise.all([
    listRoles(session.user),
    listAccessibleBranches(session.user),
  ])

  return (
    <NewUserForm
      roles={roles.map((r) => ({ id: r.id, name: r.name }))}
      branches={branches}
    />
  )
}
