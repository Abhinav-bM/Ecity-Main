import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { AnalyticsTabs } from './tabs'

export const dynamic = 'force-dynamic'

/** PRD §6.15. Nine areas, one set of controls, one place to switch between them. */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'analytics.view')) redirect('/dashboard')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Every figure is live from the documents, and every number leads somewhere.
        </p>
      </div>
      <AnalyticsTabs canSeeProfit={hasPermission(session.user, 'analytics.view_profit')} />
      {children}
    </div>
  )
}
