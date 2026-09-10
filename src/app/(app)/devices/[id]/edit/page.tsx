import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getDevice } from '@/server/services/device.service'
import { getBusiness, listTaxRates } from '@/server/services/business.service'
import { listParties } from '@/server/services/party.service'
import { DeviceEditForm } from './device-edit-form'

export const dynamic = 'force-dynamic'

const str = (v: unknown) => (v == null ? '' : String(v))
const money = (v: bigint | null) => (v == null ? '' : (Number(v) / 100).toFixed(2))

export default async function EditDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'device.edit')) redirect('/devices')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [detail, taxRates, business, suppliers] = await orNotFound(Promise.all([
    getDevice(session.user, id),
    listTaxRates(session.user),
    getBusiness(session.user),
    listParties(session.user, 'supplier', { page: 1, pageSize: 500 }),
  ]))
  const d = detail.device

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href={`/devices/${id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {d.primaryIdentifier ?? `Device #${id}`}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">Correct this device</h1>
        <p className="text-sm text-muted-foreground">
          Every change is recorded in the device&apos;s history, not applied silently.
        </p>
      </div>

      <DeviceEditForm
        deviceId={id}
        identifiers={detail.identifiers.map((i) => i.value)}
        taxRates={taxRates.map((t) => ({ id: t.id, name: t.name }))}
        gstEnabled={business.gstEnabled}
        suppliers={suppliers.rows.map((s) => ({ id: s.id, name: s.name }))}
        initial={{
          mainType: d.mainType,
          isNewCut: d.isNewCut,
          newCutNotes: str(d.newCutNotes),
          variant: str(d.variant),
          ram: str(d.ram),
          storage: str(d.storage),
          colour: str(d.colour),
          batteryHealthPercent: str(d.batteryHealthPercent),
          purchasePrice: money(d.purchasePricePaise),
          sellingPrice: money(d.sellingPricePaise),
          taxRateId: str(d.taxRateId),
          supplierId: str(d.supplierId),
          warrantyMonths: str(d.warrantyMonths),
          warrantyProvider: str(d.warrantyProvider),
          salesChannel: d.salesChannel,
          notes: str(d.notes),
        }}
      />
    </div>
  )
}
