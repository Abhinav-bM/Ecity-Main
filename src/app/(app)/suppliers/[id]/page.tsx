import { notFound, redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'

export const dynamic = 'force-dynamic'

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier.manage')) redirect('/suppliers')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const party = await getParty(session.user, 'supplier', id)

  return (
    <PartyForm
      kind="supplier"
      id={id}
      initial={{
        name: party.name,
        company: party.company ?? '',
        phone: party.phone ?? '',
        altPhone: party.altPhone ?? '',
        email: party.email ?? '',
        addressLine1: party.addressLine1 ?? '',
        addressLine2: party.addressLine2 ?? '',
        city: party.city ?? '',
        state: party.state ?? '',
        pincode: party.pincode ?? '',
        gstin: party.gstin ?? '',
        notes: party.notes ?? '',
      }}
    />
  )
}
