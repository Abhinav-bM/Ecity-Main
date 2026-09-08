import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listPermissionCatalogue, listRoles } from '@/server/services/role.service'
import { RoleEditor } from './role-editor'

export const dynamic = 'force-dynamic'

export default async function RolesPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'role.view')) redirect('/dashboard')

  const [roles, permissions] = await Promise.all([
    listRoles(session.user),
    listPermissionCatalogue(),
  ])
  const canManage = hasPermission(session.user, 'role.manage')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Roles</h1>
        <p className="text-sm text-muted-foreground">
          A role is a named set of permissions. Changing one signs the affected users out so the
          change takes effect immediately.
        </p>
        {/*
          Deliberately not paged. Roles are a master-detail editor over a list
          bounded by the business - a shop defines a handful - and paging the
          picker would mean turning a page to reach the role you came to edit.
          The count is here so the screen still states its own size, which is
          the half of pagination that was actually missing.
        */}
        <p className="mt-1 text-xs text-muted-foreground" data-testid="role-count">
          {roles.length} role{roles.length === 1 ? '' : 's'}
        </p>
      </div>

      {canManage ? (
        <RoleEditor roles={roles} permissions={permissions} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{r.name}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {r.permissions.map((p) => (
                  <Badge key={p} variant="muted" className="font-mono text-[11px]">
                    {p}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
