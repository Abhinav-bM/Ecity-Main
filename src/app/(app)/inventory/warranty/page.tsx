import Link from 'next/link'
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
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { warrantyExpiring } from '@/server/services/notification.service'
import { Pagination } from '@/components/pagination'
import { WarrantyWindow } from './warranty-window'
import { readPage } from '@/lib/list-view'
import { warrantyProviderLabel } from '@/lib/warranty'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

/**
 * PRD FR-29.2. Handsets whose cover is running out.
 *
 * In-stock pieces first in the shop's mind: a handset sold last year is the
 * customer's problem to claim, but one still on the shelf loses value the day
 * its warranty lapses, and nobody notices until it is asked about.
 */
export default async function WarrantyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const p = await searchParams
  const withinDays = Math.min(365, Math.max(1, Number(p.days ?? '60') || 60))
  const page = readPage(p.page)

  const { rows, total } = await warrantyExpiring(session.user, {
    withinDays,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Warranty</h1>
        <p className="text-sm text-muted-foreground">
          Handsets whose warranty runs out soon, and those where it lapsed just as
          recently — the same span either side of today.
        </p>
      </div>

      <Card>
        <CardContent className="py-3">
          <WarrantyWindow value={String(withinDays)} />
        </CardContent>
      </Card>

      {total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing expiring or newly lapsed within {withinDays} days. Warranty is recorded when a
            handset is booked in — a purchase line carries a “warranty until” date onto every unit
            it creates. NEW stock is not asked for one: that cover is the manufacturer&apos;s.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="warranty-cards">
            {rows.map((r) => (
              <Card key={r.id} data-testid="warranty-row">
                <CardContent className="space-y-1 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/devices/${r.id}`}
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {r.identifier ?? `#${r.id}`}
                    </Link>
                    <ExpiryBadge daysLeft={r.daysLeft} />
                  </div>
                  <p>{r.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.expires}
                    {r.provider ? ` · ${warrantyProviderLabel(r.provider)}` : ''}
                    {r.customerName ? ` · ${r.customerName}` : ''}
                    {r.branchName ? ` · ${r.branchName}` : ''}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="warranty-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Provider</TableHead>
                  {/*
                    PRD FR-29.1. On a sold handset the customer is the point:
                    "this is still covered — whose is it?" is the question the
                    list exists to answer.
                  */}
                  <TableHead>Owner</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="warranty-row">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/devices/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.identifier ?? `#${r.id}`}
                      </Link>
                    </TableCell>
                    <TableCell>{r.productName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {warrantyProviderLabel(r.provider) ?? '—'}
                    </TableCell>
                    <TableCell>
                      {r.customerId ? (
                        <Link
                          href={`/customers/${r.customerId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {r.customerName}
                        </Link>
                      ) : r.saleId ? (
                        <span className="text-muted-foreground">Walk-in</span>
                      ) : (
                        <span className="text-muted-foreground">In stock</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.branchName ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.status.replace(/_/g, ' ').toLowerCase()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.expires}</TableCell>
                    <TableCell className="text-right">
                      <ExpiryBadge daysLeft={r.daysLeft} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            basePath="/inventory/warranty"
            params={p}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            noun="handsets"
          />
        </>
      )}
    </div>
  )
}

function ExpiryBadge({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) return <Badge variant="muted">expired</Badge>
  if (daysLeft <= 7) return <Badge variant="destructive">{daysLeft}d</Badge>
  return <Badge variant="secondary">{daysLeft}d</Badge>
}
