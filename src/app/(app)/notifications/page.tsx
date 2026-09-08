import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listNotifications, listRules } from '@/server/services/notification.service'
import { NotificationCentre } from './notification-centre'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-27.1 – FR-27.3. What needs attention, without being asked.
 *
 * Scoped like every other screen: a branch user sees their branches, the
 * owner sees all of them grouped, and an alert whose subject the person has
 * no permission to open is never shown at all.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'notification.view')) redirect('/dashboard')

  const p = await searchParams
  const showAll = p.show === 'all'

  const [items, rules] = await Promise.all([
    listNotifications(session.user, {
      includeRead: showAll,
      includeResolved: showAll,
      limit: 200,
    }),
    listRules(session.user),
  ])

  return (
    <NotificationCentre
      items={items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
      rules={rules.map((r) => ({ ...r, thresholdPaise: r.thresholdPaise?.toString() ?? null }))}
      showAll={showAll}
      canManage={hasPermission(session.user, 'notification.manage')}
      groupByBranch={session.user.canViewAllBranches}
    />
  )
}
