import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listUsers, type UserListItem } from '@/server/services/user.service'
import { readListView, sortAndPage } from '@/lib/list-view'
import { Pagination } from '@/components/pagination'
import { SortableHead, SortStrip } from '@/components/sortable-head'

export const dynamic = 'force-dynamic'

function BranchList({ branches }: { branches: string[] }) {
  if (branches.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {branches.map((b) => (
        <Badge key={b} variant="muted">
          {b}
        </Badge>
      ))}
    </div>
  )
}

/** Below md a table cannot be read on a phone, so each row becomes a card. */
function UserCard({ user }: { user: UserListItem }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground" data-testid="user-email">
            {user.email}
          </p>
        </div>
        <Badge variant={user.isActive ? 'success' : 'muted'} className="shrink-0">
          {user.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Role</dt>
        <dd>{user.roleName}</dd>
        <dt className="text-muted-foreground">Branches</dt>
        <dd>
          <BranchList branches={user.branches} />
        </dd>
        <dt className="text-muted-foreground">Last in</dt>
        <dd className="text-muted-foreground">{formatDateTime(user.lastLoginAt)}</dd>
      </dl>
    </Card>
  )
}

const PAGE_SIZE = 25
const SORTS = ['name', 'email', 'role', 'lastLogin', 'status'] as const

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'user.view')) redirect('/dashboard')

  const p = await searchParams
  const view = readListView(p, SORTS, { sort: 'name' })
  const all = await listUsers(session.user)
  /*
   * Fetched whole and paged here: the list is bounded by the business - one
   * row per employee - and every other screen that reads users wants all of
   * them. See sortAndPage.
   */
  const { rows: users, total } = sortAndPage(all, view, PAGE_SIZE, (u) =>
    view.sort === 'email'
      ? u.email
      : view.sort === 'role'
        ? u.roleName
        : view.sort === 'lastLogin'
          ? (u.lastLoginAt?.getTime() ?? null)
          : view.sort === 'status'
            ? Number(u.isActive)
            : u.name,
  )
  const canManage = hasPermission(session.user, 'user.manage')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Users</h1>
          <p className="text-sm text-muted-foreground">
            Each user has a role and a set of branches. Both are enforced on every request.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href="/settings/users/new">Add user</Link>
          </Button>
        ) : null}
      </div>

      {total === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No users yet.</Card>
      ) : (
        <>
          <SortStrip
            basePath="/settings/users"
            params={p}
            columns={[
              ['name', 'Name'],
              ['email', 'Email'],
              ['role', 'Role'],
              ['lastLogin', 'Last signed in'],
              ['status', 'Status'],
            ]}
            active={view.sort}
            dir={view.dir}
            className="md:hidden"
          />
          <div className="grid gap-3 md:hidden" data-testid="user-cards">
            {users.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="user-table">
            <Table>
              <TableHeader>
                <TableRow>
                  {(
                    [
                      ['name', 'Name'],
                      ['email', 'Email'],
                      ['role', 'Role'],
                    ] as const
                  ).map(([column, label]) => (
                    <SortableHead
                      key={column}
                      basePath="/settings/users"
                      params={p}
                      column={column}
                      label={label}
                      active={view.sort}
                      dir={view.dir}
                    />
                  ))}
                  {/* Branches is a list per row, so there is nothing to sort by. */}
                  <TableHead>Branches</TableHead>
                  <SortableHead
                    basePath="/settings/users"
                    params={p}
                    column="lastLogin"
                    label="Last signed in"
                    active={view.sort}
                    dir={view.dir}
                    className="hidden lg:table-cell"
                  />
                  <SortableHead
                    basePath="/settings/users"
                    params={p}
                    column="status"
                    label="Status"
                    active={view.sort}
                    dir={view.dir}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>{u.roleName}</TableCell>
                    <TableCell>
                      <BranchList branches={u.branches} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDateTime(u.lastLoginAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? 'success' : 'muted'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/settings/users"
            params={p}
            page={view.page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="users"
          />
        </>
      )}
    </div>
  )
}
