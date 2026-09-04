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
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
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

export default async function UsersPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'user.view')) redirect('/dashboard')

  const users = await listUsers(session.user)
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

      {users.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No users yet.</Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="user-cards">
            {users.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="user-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead className="hidden lg:table-cell">Last signed in</TableHead>
                  <TableHead>Status</TableHead>
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
        </>
      )}
    </div>
  )
}
