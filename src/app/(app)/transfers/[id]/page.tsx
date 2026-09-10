import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MainTypeBadge } from '@/components/main-type-badge'
import { formatDateTime } from '@/lib/utils'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getTransfer } from '@/server/services/transfer.service'
import { TransferActions } from './transfer-actions'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT = {
  REQUESTED: 'secondary',
  APPROVED: 'warning',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
} as const

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'transfer.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const detail = await orNotFound(getTransfer(session.user, id))
  const t = detail.transfer

  /*
   * Which end of the journey this user is standing at. The server enforces it
   * too; this stops anyone being offered a button that would be refused.
   * Someone who can see every branch is exempt — they are the owner.
   */
  const everywhere = session.user.canViewAllBranches
  const atSender = everywhere || session.user.branchIds.includes(t.fromBranchId)
  const atReceiver = everywhere || session.user.branchIds.includes(t.toBranchId)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/transfers"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Transfers
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
            {t.transferNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail.fromBranchName} → {detail.toBranchName}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[t.status]} data-testid="transfer-status">
          {t.status.replace('_', ' ')}
        </Badge>
      </div>

      {t.status === 'IN_TRANSIT' ? (
        <Card className="border-warning">
          <CardContent className="py-3 text-sm">
            In transit. This stock belongs to neither branch — it cannot be sold at either end
            until it is received here.
          </CardContent>
        </Card>
      ) : null}

      {t.hasDiscrepancy ? (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm">
            <p className="font-medium">Short on receipt.</p>
            <p className="text-muted-foreground">
              {t.discrepancyNotes} — anything that did not arrive was marked lost, so it is
              accounted for rather than left in limbo.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {t.status === 'CANCELLED' ? (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm">
            Cancelled {formatDateTime(t.cancelledAt)} — {t.cancelReason}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What is on it</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.items.map((i) => (
                  <TableRow key={i.id} data-testid="transfer-item">
                    <TableCell>
                      {i.productName}
                      {i.identifier ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {i.identifier}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {i.mainType ? (
                        <MainTypeBadge mainType={i.mainType} isNewCut={i.isNewCut ?? false} />
                      ) : (
                        <span className="text-muted-foreground">Accessory</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{i.quantity}</TableCell>
                    <TableCell className="tabular text-right">
                      {t.status === 'RECEIVED' ? (
                        <span
                          className={
                            i.receivedQuantity < i.quantity ? 'font-medium text-destructive' : ''
                          }
                        >
                          {i.receivedQuantity}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TransferActions
        transferId={id}
        status={t.status}
        items={detail.items.map((i) => ({
          id: i.id,
          label: i.identifier ?? i.productName,
          identifier: i.identifier,
          quantity: i.quantity,
          isDevice: i.deviceId !== null,
        }))}
        canApprove={hasPermission(session.user, 'transfer.approve') && atSender}
        canReceive={hasPermission(session.user, 'transfer.receive') && atReceiver}
        canCancel={hasPermission(session.user, 'transfer.cancel')}
        atWrongEnd={
          (t.status === 'IN_TRANSIT' && !atReceiver) ||
          (t.status !== 'IN_TRANSIT' && !atSender)
        }
        otherBranchName={t.status === 'IN_TRANSIT' ? detail.toBranchName : detail.fromBranchName}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Where it has got to</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Requested</dt>
            <dd>
              {formatDateTime(t.requestedAt)}
              {detail.requestedByName ? ` · ${detail.requestedByName}` : ''}
            </dd>
            <dt className="text-muted-foreground">Approved</dt>
            <dd>{t.approvedAt ? formatDateTime(t.approvedAt) : '—'}</dd>
            <dt className="text-muted-foreground">Dispatched</dt>
            <dd>{t.dispatchedAt ? formatDateTime(t.dispatchedAt) : '—'}</dd>
            <dt className="text-muted-foreground">Received</dt>
            <dd>{t.receivedAt ? formatDateTime(t.receivedAt) : '—'}</dd>
          </dl>
          {t.notes ? <p className="mt-2 text-sm text-muted-foreground">{t.notes}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
