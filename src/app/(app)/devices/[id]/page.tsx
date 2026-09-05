import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeviceStatusBadge, MainTypeBadge } from '@/components/main-type-badge'
import { formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getDevice } from '@/server/services/device.service'

export const dynamic = 'force-dynamic'

const EVENT_LABEL: Record<string, string> = {
  PURCHASED: 'Purchased',
  RECEIVED: 'Received at branch',
  TRANSFERRED_OUT: 'Transferred out',
  TRANSFERRED_IN: 'Transferred in',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  RETURNED: 'Returned',
  INSPECTED: 'Inspected',
  RECLASSIFIED: 'Reclassified',
  REPAIRED: 'Repaired',
  DAMAGED: 'Marked damaged',
  LOST: 'Marked lost',
  ADJUSTED: 'Stock adjusted',
  VOIDED: 'Voided',
}

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'inventory.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const { device, productName, brandName, branchName, supplierName, identifiers, events } =
    await getDevice(session.user, id)
  const showCost = hasPermission(session.user, 'inventory.view_cost')

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
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MainTypeBadge mainType={device.mainType} isNewCut={device.isNewCut} />
        <DeviceStatusBadge status={device.status} />
        {device.salesChannel === 'EXTERNAL' ? (
          <Badge variant="outline">Billed in the other system</Badge>
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
              <dt className="text-muted-foreground">Warranty until</dt>
              <dd>{device.warrantyExpiresAt ? formatDateTime(device.warrantyExpiresAt) : '—'}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">History</CardTitle>
          <CardDescription>
            Append-only. M9 turns this into the full lifecycle view with links to each document.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-4 border-l pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute top-1.5 -left-[1.4rem] size-2 rounded-full bg-primary" />
                <p className="text-sm font-medium">{EVENT_LABEL[e.eventType] ?? e.eventType}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(e.occurredAt)}</p>
                {e.payload && Object.keys(e.payload).length > 0 ? (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
