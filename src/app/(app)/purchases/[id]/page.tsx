import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Attachments } from '@/components/attachments'
import { MainTypeBadge, DeviceStatusBadge } from '@/components/main-type-badge'
import { formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { shopDateString } from '@/lib/date'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getPurchase } from '@/server/services/purchase.service'
import { listAttachments } from '@/server/services/attachment.service'
import { ReverseButton } from './reverse-button'
import { EditPurchaseMeta } from './edit-meta'

export const dynamic = 'force-dynamic'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'muted' } as const

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const detail = await getPurchase(session.user, id)
  const files = await listAttachments(session.user, 'purchase', id)
  const canReverse =
    hasPermission(session.user, 'purchase.reverse') && detail.purchase.status === 'CONFIRMED'
  // Carried in from M5: a typo in a supplier bill number had no fix once a
  // unit from the purchase had sold, because reversal is refused by then.
  const canEditMeta =
    hasPermission(session.user, 'purchase.edit') && detail.purchase.status !== 'REVERSED'

  const owing = detail.purchase.totalPaise - detail.paidPaise

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/purchases"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Purchases
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
            {detail.purchase.purchaseNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {detail.supplierName}
            {detail.supplierCompany ? ` · ${detail.supplierCompany}` : ''} ·{' '}
            {formatDateTime(detail.purchase.purchaseDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {detail.purchase.status === 'REVERSED' ? (
            <Badge variant="destructive">Reversed</Badge>
          ) : (
            <Badge variant={PAY_VARIANT[detail.paymentStatus]}>{detail.paymentStatus}</Badge>
          )}
          {canEditMeta ? (
            <EditPurchaseMeta
              purchaseId={id}
              supplierInvoiceNumber={detail.purchase.supplierInvoiceNumber}
              purchaseDate={shopDateString(detail.purchase.purchaseDate)}
              notes={detail.purchase.notes}
            />
          ) : null}
          {canReverse ? <ReverseButton purchaseId={id} /> : null}
        </div>
      </div>

      {detail.purchase.status === 'REVERSED' ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">
            <span className="font-medium text-destructive">Reversed</span>{' '}
            {formatDateTime(detail.purchase.reversedAt)} — {detail.purchase.reversalReason}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Lines</CardTitle>
          <CardDescription>
            Received at {detail.branchName} ({detail.branchCode})
            {detail.purchase.supplierInvoiceNumber
              ? ` · supplier bill ${detail.purchase.supplierInvoiceNumber}`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                {detail.canSeeCost ? <TableHead className="text-right">Unit cost</TableHead> : null}
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">
                    {i.productName}
                    {/*
                      What the line stamped on its handsets. Shown here because
                      a bill for "iPhone 17 × 10" is ambiguous a month later,
                      and this is where somebody checks it against the
                      supplier's paperwork.
                    */}
                    {[i.storage, i.ram, i.colour, i.variant].some(Boolean) ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {[i.storage, i.ram, i.colour, i.variant].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {i.isSerialised && i.mainType ? (
                      <MainTypeBadge mainType={i.mainType} isNewCut={i.isNewCut} />
                    ) : (
                      <span className="text-xs text-muted-foreground">counted</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{i.quantity}</TableCell>
                  {detail.canSeeCost ? (
                    <TableCell className="tabular text-right">
                      {formatMoney(i.unitCostPaise)}
                    </TableCell>
                  ) : null}
                  <TableCell className="tabular text-right">
                    {formatMoney(i.lineTotalPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular text-right">{formatMoney(detail.purchase.subtotalPaise)}</dd>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular text-right">−{formatMoney(detail.purchase.discountPaise)}</dd>
            <dt className="font-medium">Total</dt>
            <dd className="tabular text-right font-medium">
              {formatMoney(detail.purchase.totalPaise)}
            </dd>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="tabular text-right">{formatMoney(detail.paidPaise)}</dd>
            <dt className="font-medium">Outstanding</dt>
            <dd className="tabular text-right font-medium">{formatMoney(owing)}</dd>
          </dl>
        </CardContent>
      </Card>

      {detail.devices.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Units registered</CardTitle>
            <CardDescription>
              {detail.devices.length} unit{detail.devices.length === 1 ? '' : 's'}, each with its
              own identifier and history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {detail.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Link
                    href={`/devices/${d.id}`}
                    className="min-w-0 flex-1 truncate font-mono underline-offset-4 hover:underline"
                  >
                    {d.identifier ?? `#${d.id}`}
                  </Link>
                  <MainTypeBadge mainType={d.mainType} isNewCut={d.isNewCut} />
                  <DeviceStatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Attachments
        entityType="purchase"
        entityId={id}
        rows={files}
        canManage={hasPermission(session.user, 'attachment.upload')}
        description="The supplier's bill, delivery note or photos. Images or PDF, up to 5 MB."
      />
    </div>
  )
}
