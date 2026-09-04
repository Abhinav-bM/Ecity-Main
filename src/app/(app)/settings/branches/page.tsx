import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listBranches } from '@/server/services/branch.service'
import { BranchList } from './branch-list'

export const dynamic = 'force-dynamic'

export default async function BranchesPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'branch.manage')) redirect('/dashboard')

  const branches = await listBranches(session.user)
  const canManage = hasPermission(session.user, 'branch.manage')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Branches</h1>
          <p className="text-sm text-muted-foreground">
            A deactivated branch keeps all of its history but cannot be used for new
            transactions.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href="/settings/branches/new">Add branch</Link>
          </Button>
        ) : null}
      </div>

      {branches.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No branches yet.</Card>
      ) : (
        <BranchList branches={branches} canManage={canManage} />
      )}
    </div>
  )
}
