import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { getSessionContext } from '@/server/auth/session'
import { listAccessibleBranches } from '@/server/services/branch.service'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const branches = await listAccessibleBranches(session.user)

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        permissions: [...session.user.permissions],
        canViewAllBranches: session.user.canViewAllBranches,
      }}
      branches={branches}
      activeBranchId={session.activeBranchId}
    >
      {children}
    </AppShell>
  )
}
