import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listBranches } from '@/server/services/branch.service'
import { readListView, sortAndPage } from '@/lib/list-view'
import { Pagination } from '@/components/pagination'
import { BranchList } from './branch-list'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const SORTS = ['code', 'name', 'city', 'manager', 'users', 'status'] as const

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'branch.manage')) redirect('/dashboard')

  const p = await searchParams
  const view = readListView(p, SORTS, { sort: 'code' })
  const all = await listBranches(session.user)
  // Bounded by the business — a shop has a handful of branches, and every
  // picker in the app reads this same list whole. See sortAndPage.
  const { rows: branches, total } = sortAndPage(all, view, PAGE_SIZE, (b) =>
    view.sort === 'name'
      ? b.name
      : view.sort === 'city'
        ? b.city
        : view.sort === 'manager'
          ? b.managerName
          : view.sort === 'users'
            ? b.userCount
            : view.sort === 'status'
              ? b.status
              : b.code,
  )
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

      {total === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No branches yet.</Card>
      ) : (
        <>
          <BranchList
            branches={branches}
            canManage={canManage}
            params={p}
            sort={view.sort}
            dir={view.dir}
          />
          <Pagination
            basePath="/settings/branches"
            params={p}
            page={view.page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="branches"
          />
        </>
      )}
    </div>
  )
}
