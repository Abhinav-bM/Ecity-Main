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
import { formatDateShort } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listTransfers, type TransferStatus } from '@/server/services/transfer.service'
import { StatusFilter } from './status-filter'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const STATUS_VARIANT: Record<TransferStatus, 'secondary' | 'warning' | 'success' | 'destructive'> =
  {
    REQUESTED: 'secondary',
    APPROVED: 'warning',
    IN_TRANSIT: 'warning',
    RECEIVED: 'success',
    CANCELLED: 'destructive',
  }

/** PRD FR-3.6. Stock moving between branches, and where each one has got to. */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'transfer.view')) redirect('/dashboard')

  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const status = p.status as TransferStatus | undefined

  const { rows, total } = await listTransfers(session.user, {
    status,
    search: p.search,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Transfers</h1>
          <p className="text-sm text-muted-foreground">
            While a transfer is in transit its stock belongs to neither branch — it cannot be sold
            at either end.
          </p>
        </div>
        {hasPermission(session.user, 'transfer.request') ? (
          <Button asChild size="sm">
            <Link href="/transfers/new">Request a transfer</Link>
          </Button>
        ) : null}
      </div>

      <StatusFilter status={status ?? ''} search={p.search ?? ''} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing here yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="transfer-cards">
            {rows.map((t) => (
              <Card key={t.id} data-testid="transfer-row">
                <CardContent className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/transfers/${t.id}`}
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {t.transferNumber}
                    </Link>
                    <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {t.fromBranchName} → {t.toBranchName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.lineCount} line(s) · requested {formatDateShort(t.requestedAt)}
                  </p>
                  {t.hasDiscrepancy ? <Badge variant="destructive">Short on receipt</Badge> : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} data-testid="transfer-row">
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/transfers/${t.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {t.transferNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.fromBranchName}</TableCell>
                    <TableCell className="text-muted-foreground">{t.toBranchName}</TableCell>
                    <TableCell className="tabular">{t.lineCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateShort(t.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[t.status]}>
                        {t.status.replace('_', ' ')}
                      </Badge>
                      {t.hasDiscrepancy ? (
                        <Badge variant="destructive" className="ml-1.5">
                          Short
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/transfers"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="transfers"
          />
        </>
      )}
    </div>
  )
}
