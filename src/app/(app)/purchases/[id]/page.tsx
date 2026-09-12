import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { formatDateShort, formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { shopDateString } from '@/lib/date'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getPurchase } from '@/server/services/purchase.service'
import { listPaymentMethods } from '@/server/services/business.service'
import { listAttachments } from '@/server/services/attachment.service'
import { ReverseButton } from './reverse-button'
import { EditPurchaseMeta } from './edit-meta'
import { PayPurchaseButton } from './pay-button'

export const dynamic = 'force-dynamic'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'muted' } as const

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const detail = await orNotFound(getPurchase(session.user, id))
  const files = await orNotFound(listAttachments(session.user, 'purchase', id))
  const canReverse =
    hasPermission(session.user, 'purchase.reverse') && detail.purchase.status === 'CONFIRMED'
  // Carried in from M5: a typo in a supplier bill number had no fix once a
  // unit from the purchase had sold, because reversal is refused by then.
  const canEditMeta =
    hasPermission(session.user, 'purchase.edit') && detail.purchase.status !== 'REVERSED'

  const owing = detail.purchase.totalPaise - detail.paidPaise

  /*
   * Paying from the bill you are looking at.
   *
   * There was no way to do it here: the only payment UI lived on the supplier
   * dues screen, which pays the supplier and allocates oldest-first. So
   * settling one bill meant leaving it, finding the supplier, and hoping the
   * oldest open purchase was the one you meant.
   */
  const canPay =
    hasPermission(session.user, 'supplier_payment.manage') &&
    detail.purchase.status === 'CONFIRMED' &&
    owing > 0n
  const paymentMethods = canPay
    ? (await listPaymentMethods(session.user))
        .filter((m) => m.isActive)
        .map((m) => ({ id: m.id, name: m.name }))
    : []

  type Spec = { variant: string | null; ram: string | null; storage: string | null; colour: string | null }

  /** The readable combination, in the order a shop says it out loud. */
  const specsOf = (s: Spec) =>
    [s.storage, s.ram, s.colour, s.variant].filter(Boolean).join(' · ') || 'no specs'

  /**
   * Units from this line whose specs no longer match what the line stamped,
   * grouped by what they now say - so ten handsets corrected the same way are
   * one sentence, not ten.
   */
  function correctionsFor(item: (typeof detail.items)[number]) {
    const differing = detail.devices.filter(
      (d) => d.purchaseItemId === item.id && specsOf(d) !== specsOf(item),
    )
    const bySpecs = new Map<string, number>()
    for (const d of differing) bySpecs.set(specsOf(d), (bySpecs.get(specsOf(d)) ?? 0) + 1)
    return [...bySpecs.entries()].map(([specs, count]) => ({ specs, count }))
  }

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
            {/*
              A bill date is a date. It comes off a supplier's piece of paper,
              which carries no time, and is stored as midnight in the shop's
              zone - so rendering it with a time printed a phantom "12:00 am"
              that disagreed with every other screen showing the same purchase.
            */}
            Billed {formatDateShort(detail.purchase.purchaseDate)}
            {/*
              Only worth saying when the goods came on a different day; on a
              counter purchase the two are the same and repeating it is noise.
            */}
            {detail.purchase.arrivedAt &&
            shopDateString(detail.purchase.arrivedAt) !==
              shopDateString(detail.purchase.purchaseDate)
              ? ` · Arrived ${formatDateShort(detail.purchase.arrivedAt)}`
              : ''}
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
              arrivedAt={
                detail.purchase.arrivedAt ? shopDateString(detail.purchase.arrivedAt) : ''
              }
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
                        {specsOf(i)}
                      </span>
                    ) : null}
                    {/*
                      Where a handset has since been corrected, say so here.

                      The line keeps what was booked in - a document is not
                      rewritten, the same rule an invoice follows - and the
                      handset keeps the truth. Without this the two screens
                      simply disagree: the bill says green, the device says
                      blue, and nothing explains which to believe.
                    */}
                    {correctionsFor(i).map((c) => (
                      <span
                        key={c.specs}
                        className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-normal"
                        data-testid="line-corrected"
                      >
                        {/*
                          A badge, not coloured text: `text-warning-foreground`
                          is meant to sit on a warning background and all but
                          disappears on a plain cell in dark mode.
                        */}
                        <Badge variant="warning">Corrected</Badge>
                        <span className="text-muted-foreground">
                          {c.count} {c.count === 1 ? 'unit is' : 'units are'} now{' '}
                          {c.specs}
                        </span>
                      </span>
                    ))}
                  </TableCell>
                  <TableCell>
                    {/*
                      Shown whenever the line carries one. It used to be gated
                      on the line being serialised, so an accessory classified
                      at purchase stored the answer and never showed it again.
                    */}
                    {i.mainType ? (
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

          {canPay ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {/*
                The supplier's whole account, for when this bill is not the
                question - an advance, or clearing several at once.
              */}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/suppliers/${detail.purchase.supplierId}`}>
                  {detail.supplierName}&rsquo;s account
                </Link>
              </Button>
              <PayPurchaseButton
                purchaseId={id}
                supplierId={detail.purchase.supplierId}
                supplierName={detail.supplierName}
                branchId={detail.purchase.branchId}
                owingPaise={owing}
                paymentMethods={paymentMethods}
              />
            </div>
          ) : null}
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
