import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getSessionContext } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const { user, activeBranchId } = session

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name}. The real dashboard arrives in M10 — this page confirms that
          authentication, branch context and permissions are wired up.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Branch context</CardTitle>
            <CardDescription>What this session is scoped to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active branch</span>
              <span className="font-medium">
                {activeBranchId ?? (user.canViewAllBranches ? 'All branches' : 'None')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Accessible branches</span>
              <span className="font-medium">{user.branchIds.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consolidated view</span>
              <span className="font-medium">{user.canViewAllBranches ? 'Yes' : 'No'}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Your permissions</CardTitle>
            <CardDescription>
              Granted by your role. Every API call re-checks these on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {[...user.permissions].sort().map((p) => (
              <Badge key={p} variant="muted" className="max-w-full truncate font-mono text-[11px]">
                {p}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
