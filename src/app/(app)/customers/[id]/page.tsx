import { notFound, redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'

export const dynamic = 'force-dynamic'

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer.manage')) redirect('/customers')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const party = await getParty(session.user, 'customer', id)

  return (
    <PartyForm
      kind="customer"
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
