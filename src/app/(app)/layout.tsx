import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { getSessionContext } from '@/server/auth/session'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { hasPermission } from '@/server/auth/permissions'
import { unreadCount } from '@/server/services/notification.service'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const [branches, unreadAlerts] = await Promise.all([
    listAccessibleBranches(session.user),
    // Counted here so the badge is right on first paint, and only for
    // someone who may see alerts at all.
    hasPermission(session.user, 'notification.view') ? unreadCount(session.user) : 0,
  ])

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
      unreadAlerts={unreadAlerts}
    >
      {children}
    </AppShell>
  )
}
