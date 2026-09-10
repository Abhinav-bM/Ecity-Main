import { redirect } from 'next/navigation'
import { Pagination } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
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
import { describeChanges, type Change } from '@/lib/changes'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAuditLog } from '@/server/services/audit.service'
import { readPage } from '@/lib/list-view'

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
  const page = readPage(params.page)

  const { rows, total, pageSize } = await listAuditLog(session.user, {
    page,
    pageSize: 50,
    entityType: params.entityType,
    action: params.action,
  })


  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only. {total.toLocaleString('en-IN')} entries. Branch-scoped to what you can see.
        </p>
      </div>

      {/* Phones get one card per entry; the six-column table is unreadable below md. */}
      <div className="grid gap-3 md:hidden" data-testid="audit-cards">
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
              <ChangeLines changes={r.changes as Record<string, Change> | null} />
            </Card>
          ))
        )}
      </div>

      <Card className="hidden overflow-hidden md:block" data-testid="audit-table">
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
                    <ChangeLines changes={r.changes as Record<string, Change> | null} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pagination
        basePath="/settings/audit"
        params={params}
        page={page}
        pageSize={pageSize}
        total={total}
        noun="entries"
      />
    </div>
  )
}

/**
 * What changed, in words.
 *
 * This used to print the stored diff as JSON. That is a developer's view on
 * the one page an owner opens to ask "who changed this price?" — and
 * `"sellingPricePaise": { "to": 1400000 }` does not answer it. Same data,
 * spelled for a person: money as rupees, rates as percentages, enums in
 * lower case, and a create reading as "set to" rather than "changed from
 * null".
 *
 * Long lists stay collapsed: a role edit can change forty permissions at
 * once, and that should not push every other row off the screen.
 */
function ChangeLines({ changes }: { changes: Record<string, Change> | null }) {
  const lines = describeChanges(changes)
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>

  if (lines.length <= 3) {
    return (
      <ul className="space-y-0.5 text-xs" data-testid="audit-changes">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    )
  }

  return (
    <details data-testid="audit-changes">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {lines.length} changes
      </summary>
      <ul className="mt-1 space-y-0.5 text-xs">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )
}
