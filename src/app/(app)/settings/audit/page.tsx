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
import { listAuditLog } from '@/server/services/audit.service'

export const dynamic = 'force-dynamic'

const ACTION_VARIANT: Record<string, 'default' | 'muted' | 'destructive' | 'success'> = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
  LOGIN: 'muted',
  LOGIN_FAILED: 'destructive',
  LOGOUT: 'muted',
  PERMISSION_CHANGED: 'default',
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entityType?: string; action?: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'audit.view')) redirect('/dashboard')

  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? '1') || 1)

  const { rows, total, pageSize } = await listAuditLog(session.user, {
    page,
    pageSize: 50,
    entityType: params.entityType,
    action: params.action,
  })

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only. {total.toLocaleString('en-IN')} entries. Branch-scoped to what you can see.
        </p>
      </div>

      {/* Phones get one card per entry; the six-column table is unreadable below md. */}
      <div className="grid gap-3 md:hidden">
        {rows.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            Nothing recorded yet.
          </Card>
        ) : (
          rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={ACTION_VARIANT[r.action] ?? 'muted'}>{r.action}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(r.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-sm">{r.summary ?? '—'}</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {r.entityType}
                {r.entityId ? `#${r.entityId}` : ''} · {r.actorLabel ?? 'system'}
              </p>
              {r.changes ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {Object.keys(r.changes).length} field(s) changed
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(r.changes, null, 2)}
                  </pre>
                </details>
              ) : null}
            </Card>
          ))
        )}
      </div>

      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden lg:table-cell">Entity</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nothing recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell>{r.actorLabel ?? 'system'}</TableCell>
                  <TableCell>
                    <Badge variant={ACTION_VARIANT[r.action] ?? 'muted'}>{r.action}</Badge>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell">
                    {r.entityType}
                    {r.entityId ? `#${r.entityId}` : ''}
                  </TableCell>
                  <TableCell>{r.summary ?? '—'}</TableCell>
                  <TableCell className="max-w-xs min-w-[10rem]">
                    {r.changes ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {Object.keys(r.changes).length} field(s)
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(r.changes, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={page <= 1}>
              <Link href={`/settings/audit?page=${page - 1}`}>Previous</Link>
            </Button>
            <Button variant="outline" size="sm" asChild disabled={page >= pages}>
              <Link href={`/settings/audit?page=${page + 1}`}>Next</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
