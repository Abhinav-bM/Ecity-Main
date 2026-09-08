import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeviceStatusBadge, MainTypeBadge } from '@/components/main-type-badge'
import { formatDateShort, formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getDevice } from '@/server/services/device.service'
import {
  deviceCommercials,
  devicePosition,
  deviceTimeline,
} from '@/server/services/device-history.service'
import { SoldExternallyButton } from './sold-externally-button'

export const dynamic = 'force-dynamic'

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const { device, productName, brandName, branchName, supplierName, identifiers } =
    await getDevice(session.user, id)
  const showCost = hasPermission(session.user, 'inventory.view_cost')

  /*
   * M9 FR-30.5, FR-30.6. getDevice already proved the caller may see this
   * device, so these two run together rather than one after the other.
   */
  const [timeline, commercials, position] = await Promise.all([
    deviceTimeline(session.user, id),
    deviceCommercials(id),
    devicePosition(id),
  ])
  const soldFor = commercials.at(-1) ?? null

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href="/devices" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Devices
        </Link>
        <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
          {device.primaryIdentifier ?? `Device #${device.id}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {brandName ? `${brandName} ` : ''}
          {productName}
          {identifiers.length > 1 ? ` · ${identifiers.length} identifiers` : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MainTypeBadge mainType={device.mainType} isNewCut={device.isNewCut} />
        <DeviceStatusBadge status={device.status} />
        {device.salesChannel === 'EXTERNAL' ? (
          <Badge variant="outline">Billed in the other system</Badge>
        ) : null}
        {hasPermission(session.user, 'device.edit') ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/devices/${device.id}/edit`}>Edit</Link>
          </Button>
        ) : null}
        {device.salesChannel !== 'ECITY' &&
        device.status === 'IN_STOCK' &&
        hasPermission(session.user, 'sale.create') ? (
          <SoldExternallyButton deviceId={device.id} />
        ) : null}
        {device.source === 'LEGACY' ? <Badge variant="muted">Imported</Badge> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Identifiers</CardTitle>
            <CardDescription>
              A phone carries an IMEI per SIM slot; a laptop or speaker carries a serial number. Any of them finds the device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {identifiers.map((i) => (
                <li key={i.id} className="flex items-center gap-2 font-mono text-sm">
                  <span className="text-xs text-muted-foreground">Slot {i.slot}</span>
                  {i.value}
                  {i.isPrimary ? (
                    <Badge variant="secondary" className="ml-auto">
                      Primary
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Previous branch</dt>
              <dd>{position.previousBranchName ?? '—'}</dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{branchName ?? '—'}</dd>
              <dt className="text-muted-foreground">Variant</dt>
              <dd>{device.variant ?? '—'}</dd>
              <dt className="text-muted-foreground">RAM / Storage</dt>
              <dd>{[device.ram, device.storage].filter(Boolean).join(' / ') || '—'}</dd>
              <dt className="text-muted-foreground">Colour</dt>
              <dd>{device.colour ?? '—'}</dd>
              <dt className="text-muted-foreground">Battery health</dt>
              <dd>
                {device.batteryHealthPercent != null ? (
                  <span
                    className={
                      device.batteryHealthPercent < 80 ? 'font-medium text-warning-foreground' : ''
                    }
                  >
                    {device.batteryHealthPercent}%
                  </span>
                ) : (
                  '—'
                )}
              </dd>
              {device.isNewCut && device.newCutNotes ? (
                <>
                  <dt className="text-muted-foreground">NEW CUT</dt>
                  <dd>{device.newCutNotes}</dd>
                </>
              ) : null}
              {showCost ? (
                <>
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="tabular">{formatMoney(device.purchasePricePaise)}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Selling price</dt>
              <dd className="tabular">{formatMoney(device.sellingPricePaise)}</dd>
              <dt className="text-muted-foreground">Supplier</dt>
              <dd>{supplierName ?? '—'}</dd>
              <dt className="text-muted-foreground">Purchased</dt>
              <dd>{device.purchaseDate ? formatDateTime(device.purchaseDate) : '—'}</dd>
              {/*
                PRD FR-29.1 – FR-29.2. Everything a warranty claim needs, in
                one place: how long, until when, and *who honours it* — the
                customer's first question is "who do I take it to", and
                without the provider the answer is a phone call to whoever
                happened to sell it.
              */}
              <dt className="text-muted-foreground">Warranty</dt>
              <dd data-testid="device-warranty">
                {device.warrantyExpiresAt ? (
                  <>
                    {formatDateShort(device.warrantyExpiresAt)}
                    {device.warrantyMonths ? ` · ${device.warrantyMonths} months` : ''}
                    {device.warrantyProvider ? ` · ${device.warrantyProvider}` : ''}
                    <WarrantyState expiresAt={device.warrantyExpiresAt} />
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      {soldFor ? (
        <Card data-testid="device-commercials">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">What it sold for</CardTitle>
            <CardDescription>
              Taken from the bill, not the list price — what it actually went for.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Sold on</dt>
              <dd>
                <Link
                  href={`/sales/${soldFor.saleId}`}
                  className="font-mono underline underline-offset-4"
                >
                  {soldFor.invoiceNumber}
                </Link>
                <span className="text-muted-foreground"> · {formatDateTime(soldFor.soldAt)}</span>
              </dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                {soldFor.customerId ? (
                  <Link
                    href={`/customers/${soldFor.customerId}`}
                    className="underline underline-offset-4"
                  >
                    {soldFor.customerName}
                  </Link>
                ) : (
                  'Walk-in'
                )}
              </dd>
              <dt className="text-muted-foreground">Sold for</dt>
              <dd className="tabular">{formatMoney(soldFor.lineTotalPaise)}</dd>
              {soldFor.discountPaise > 0n ? (
                <>
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd className="tabular">−{formatMoney(soldFor.discountPaise)}</dd>
                </>
              ) : null}
              {showCost && device.purchasePricePaise != null ? (
                <>
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="tabular">{formatMoney(device.purchasePricePaise)}</dd>
                  <dt className="text-muted-foreground">Margin</dt>
                  <dd className="tabular">
                    {formatMoney(soldFor.lineTotalPaise - device.purchasePricePaise)}
                  </dd>
                </>
              ) : null}
              {/* Paid versus credit, for the bill this handset went out on. */}
              <dt className="text-muted-foreground">Payment</dt>
              <dd>
                <Badge
                  variant={
                    soldFor.paymentStatus === 'PAID'
                      ? 'success'
                      : soldFor.paymentStatus === 'PARTIAL'
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {soldFor.paymentStatus}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Paid / on credit</dt>
              <dd className="tabular">
                {formatMoney(soldFor.paidPaise)}
                {soldFor.creditPaise > 0n ? ` · ${formatMoney(soldFor.creditPaise)} owing` : ''}
              </dd>
            </dl>
            {commercials.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Sold {commercials.length} times — it came back and went out again. The timeline
                below has the whole story.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/*
        FR-30.6. The chain end to end: Purchase → Seller → Branch → Transfers →
        Sale → Customer → Return/Repair/Other, each entry linking to the
        document it came from.
      */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Its whole life</CardTitle>
          <CardDescription>
            Append-only, in the order it happened. Every entry links to the document behind it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5" data-testid="device-timeline">
              {timeline.map((e) => (
                <li key={e.id} className="relative" data-testid="timeline-entry">
                  <span className="absolute top-1.5 -left-[1.4rem] size-2 rounded-full bg-primary" />
                  <p className="text-sm font-medium">{e.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.occurredAt)}
                    {e.branchName && !e.fromBranchName ? ` · ${e.branchName}` : ''}
                  </p>
                  {e.link ? (
                    <Link
                      href={e.link.href}
                      className="mt-0.5 inline-block font-mono text-xs underline underline-offset-4"
                    >
                      {e.link.label}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

    </div>
  )
}

/**
 * Whether the cover is still good, said plainly.
 *
 * A date alone makes the reader do the arithmetic, and the whole point of
 * showing warranty on this page is answering "is this still covered?" without
 * one.
 */
function WarrantyState({ expiresAt }: { expiresAt: Date }) {
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return <Badge variant="muted" className="ml-2">expired</Badge>
  if (days <= 30)
    return (
      <Badge variant="destructive" className="ml-2">
        {days} days left
      </Badge>
    )
  return <Badge variant="secondary" className="ml-2">in warranty</Badge>
}
