import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeviceStatusBadge, MainTypeBadge } from '@/components/main-type-badge'
import { cn, formatDateShort, formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { shopDateString } from '@/lib/date'
import { warrantyProviderLabel } from '@/lib/warranty'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getDevice } from '@/server/services/device.service'
import {
  deviceCommercials,
  devicePosition,
  deviceTimeline,
  identifierLineage,
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
    await orNotFound(getDevice(session.user, id))
  const showCost = hasPermission(session.user, 'inventory.view_cost')

  /*
   * M9 FR-30.5, FR-30.6. getDevice already proved the caller may see this
   * device, so these two run together rather than one after the other.
   */
  const [timeline, commercials, position] = await orNotFound(Promise.all([
    deviceTimeline(session.user, id),
    deviceCommercials(id),
    devicePosition(id),
  ]))
  const soldFor = commercials.at(-1) ?? null

  /*
   * The number's whole story, not just this row's.
   *
   * A handset bought back is a new device_unit, so its page would otherwise
   * open on an empty history and give no hint the shop has handled this exact
   * phone before - which is the first thing worth knowing when one comes over
   * the counter. Empty unless the identifier really has carried more than one
   * unit, so an ordinary device shows nothing extra.
   */
  const lineage = device.primaryIdentifier
    ? await identifierLineage(session.user, device.primaryIdentifier)
    : []

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
              {/*
                What each one IS, not just where it sits. A handset can carry
                two IMEIs and the serial from its box, and "Slot 3" says
                nothing about which of those is being read out to a customer.
              */}
              {identifiers.map((i) => (
                <li key={i.id} className="flex items-center gap-2 font-mono text-sm">
                  <span className="text-xs text-muted-foreground">
                    {i.type === 'SERIAL'
                      ? 'Serial'
                      : identifiers.filter((o) => o.type === 'IMEI').length > 1
                        ? `IMEI ${i.slot}`
                        : 'IMEI'}
                  </span>
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
              {/*
                No longer collected - the model tier lives in the product name
                ("iPhone 17 Pro Max"), which is the field reports group by.
                Still shown for the handsets booked in before that, so nothing
                already recorded disappears from the record.
              */}
              {device.variant ? (
                <>
                  <dt className="text-muted-foreground">Variant</dt>
                  <dd>{device.variant}</dd>
                </>
              ) : null}
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
                    {device.warrantyProvider
                      ? ` · ${warrantyProviderLabel(device.warrantyProvider)}`
                      : ''}
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
      {/*
        The IMEI's story, above this unit's own.
        
        It only appears when the number really has carried more than one unit,
        which means it appears exactly when it matters: a handset the shop has
        handled before. Each row links to that unit's own full timeline, so the
        chain is walkable end to end rather than summarised here.
      */}
      {lineage.length > 0 ? (
        <Card data-testid="identifier-lineage">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">This IMEI has been here before</CardTitle>
            <CardDescription>
              Everything that has happened to {device.primaryIdentifier}, across every unit that
              has carried it — bought, sold, bought again. Newest first, so where it stands today
              is the top line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-5" data-testid="lineage-events">
              {lineage.map((e) => (
                <li
                  key={`${e.kind}-${e.deviceId}-${e.at.toISOString()}`}
                  className="relative"
                  data-testid="lineage-event"
                >
                  {/*
                    Filled for what the shop did, hollow for what left - the
                    shape alone tells you which way the handset moved.
                  */}
                  <span
                    className={cn(
                      'absolute top-1.5 -left-[1.4rem] size-2 rounded-full border',
                      e.kind === 'ACQUIRED'
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground bg-background',
                    )}
                  />
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {/*
                      Says which time round this was, so two purchases of the
                      same handset are never mistaken for one another.
                    */}
                    <span className="text-xs font-normal text-muted-foreground">#{e.pass}</span>
                    {e.kind === 'ACQUIRED'
                      ? e.pass === 1
                        ? 'Purchased'
                        : 'Purchased again'
                      : 'Sold'}
                    {showCost && e.amountPaise ? ` — ${formatMoney(e.amountPaise)}` : ''}
                    {e.partyName
                      ? ` ${e.kind === 'ACQUIRED' ? 'from' : 'to'} ${e.partyName}`
                      : ''}
                    {e.mainType ? <MainTypeBadge mainType={e.mainType} isNewCut={false} /> : null}
                    {/*
                      Only on the acquisition that is still standing: this is
                      the handset the shop can sell today, which is the single
                      most useful fact on the card.
                    */}
                    {e.holdsIdentifier && e.inHand ? (
                      <Badge variant="secondary">Have it now</Badge>
                    ) : null}
                    {e.status && !e.inHand && e.kind === 'ACQUIRED' ? (
                      <DeviceStatusBadge status={e.status} />
                    ) : null}
                  </p>
                  {/*
                    The time, not just the day. Two things that happened on one
                    afternoon are indistinguishable without it, and that is
                    precisely when the order is worth reading.

                    `recordedAt` is a real moment; `at` may be a supplier's bill
                    date, which carries no time. They are shown separately when
                    they differ, because a bill dated a week before the goods
                    arrived is a real and useful thing to see - not an error to
                    paper over by picking one of them.
                  */}
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.recordedAt)}
                    {e.kind === 'ACQUIRED' &&
                    shopDateString(e.at) !== shopDateString(e.recordedAt)
                      ? ` · bill dated ${formatDateShort(e.at)}`
                      : ''}
                    {e.deviceId === device.id ? ' · this record' : ''}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3">
                    {e.link ? (
                      <Link
                        href={e.link.href}
                        className="font-mono text-xs underline underline-offset-4"
                      >
                        {e.link.label}
                      </Link>
                    ) : null}
                    {/* The other unit's own full timeline is one click away. */}
                    {e.deviceId !== device.id && e.kind === 'ACQUIRED' ? (
                      <Link
                        href={`/devices/${e.deviceId}`}
                        className="text-xs underline underline-offset-4"
                      >
                        Open that record
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Its whole life</CardTitle>
          <CardDescription>
            Newest first. Append-only — every entry links to the document behind it.
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
