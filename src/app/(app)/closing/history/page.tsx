import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
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
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listClosings } from '@/server/services/closing.service'
import { readPage } from '@/lib/list-view'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

/** PRD FR-13.5. Every day this shop has signed off. */
export default async function ClosingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'closing.view')) redirect('/dashboard')

  const p = await searchParams
  const page = readPage(p.page)
  const { rows, total } = await listClosings(session.user, {
    branchId: p.branchId ? Number(p.branchId) : undefined,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Closing history</h1>
        <p className="text-sm text-muted-foreground">
          Newest first. A voided closing is kept — that a day was closed and reopened is part of
          the record.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No day has been closed yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="closing-cards">
            {rows.map((c) => (
              <Card key={c.id} data-testid="closing-row">
                <CardContent className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{c.businessDate}</p>
                      <p className="text-xs text-muted-foreground">{c.branchName}</p>
                    </div>
                    <DifferenceBadge paise={c.cashDifferencePaise} voided={c.voidedAt !== null} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expected {formatMoney(c.expectedCashPaise)} · counted{' '}
                    {formatMoney(c.countedCashPaise)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.closedByName ?? '—'} · {formatDateTime(c.closedAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Closed by</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} data-testid="closing-row">
                    <TableCell className="whitespace-nowrap">{c.businessDate}</TableCell>
                    <TableCell className="text-muted-foreground">{c.branchName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.closedByName ?? '—'}
                      <span className="block text-xs">{formatDateTime(c.closedAt)}</span>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatMoney(c.expectedCashPaise)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatMoney(c.countedCashPaise)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DifferenceBadge
                        paise={c.cashDifferencePaise}
                        voided={c.voidedAt !== null}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/closing/history"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="days"
          />
        </>
      )}
    </div>
  )
}

function DifferenceBadge({ paise, voided }: { paise: bigint; voided: boolean }) {
  if (voided) return <Badge variant="secondary">Reopened</Badge>
  if (paise === 0n) return <Badge variant="success">Matched</Badge>
  if (paise < 0n) return <Badge variant="destructive">{formatMoney(-paise)} short</Badge>
  return <Badge variant="warning">{formatMoney(paise)} over</Badge>
}
