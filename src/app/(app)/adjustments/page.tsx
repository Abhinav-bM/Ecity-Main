import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pagination } from '@/components/pagination'
import { MainTypeBadge } from '@/components/main-type-badge'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAdjustments } from '@/server/services/adjustment.service'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const REASON_LABEL: Record<string, string> = {
  DAMAGE: 'Damage',
  LOSS: 'Loss',
  MISCOUNT: 'Miscount',
  DATA_ENTRY_ERROR: 'Data-entry error',
}

/** PRD FR-28.1 – FR-28.3. Where the shelf and the system were made to agree. */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'adjustment.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const { rows, total } = await listAdjustments(session.user, { page, pageSize: PAGE_SIZE })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Stock adjustments</h1>
          <p className="text-sm text-muted-foreground">
            Corrections between what is on the shelf and what the system thinks. Each one names the
            reason and the person, and is never edited afterwards.
          </p>
        </div>
        {hasPermission(session.user, 'adjustment.create') ? (
          <Button asChild size="sm">
            <Link href="/adjustments/new">Adjust stock</Link>
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing adjusted yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="adjustment-cards">
            {rows.map((a) => (
              <Card key={a.id} data-testid="adjustment-row">
                <CardContent className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/adjustments/${a.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {a.productName}
                      </Link>
                      {a.identifier ? (
                        <p className="font-mono text-xs text-muted-foreground">{a.identifier}</p>
                      ) : null}
                    </div>
                    <Badge variant="warning">{REASON_LABEL[a.reason] ?? a.reason}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.branchName} · {formatDateTime(a.adjustedAt)} · {a.adjustedBy ?? '—'}
                  </p>
                  <p className="tabular text-sm">
                    {a.deviceId
                      ? `${a.deviceStatusBefore} → ${a.deviceStatusAfter}`
                      : `${a.quantityBefore} → ${a.quantityAfter}`}
                  </p>
                  {a.notes ? <p className="text-xs text-muted-foreground">{a.notes}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} data-testid="adjustment-row">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(a.adjustedAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/adjustments/${a.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {a.productName}
                      </Link>
                      {a.identifier ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {a.identifier}
                        </span>
                      ) : null}
                      {a.mainTypeSnapshot ? (
                        <MainTypeBadge
                          mainType={a.mainTypeSnapshot}
                          isNewCut={a.isNewCutSnapshot}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.branchName}</TableCell>
                    <TableCell>
                      <Badge variant="warning">{REASON_LABEL[a.reason] ?? a.reason}</Badge>
                    </TableCell>
                    <TableCell className="tabular">
                      {a.deviceId ? (
                        `${a.deviceStatusBefore} → ${a.deviceStatusAfter}`
                      ) : (
                        <>
                          {a.quantityBefore} → {a.quantityAfter}
                          <span
                            className={
                              a.quantityDelta < 0
                                ? 'ml-1 text-destructive'
                                : 'ml-1 text-success'
                            }
                          >
                            ({a.quantityDelta > 0 ? '+' : ''}
                            {a.quantityDelta})
                          </span>
                        </>
                      )}
                      {a.notes ? (
                        <span className="block text-xs text-muted-foreground">{a.notes}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.adjustedBy ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/adjustments"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="adjustments"
          />
        </>
      )}
    </div>
  )
}
