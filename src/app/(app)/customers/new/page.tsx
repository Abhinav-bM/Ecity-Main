import { redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function NewCustomerPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer.manage')) redirect('/customers')
  return <PartyForm kind="customer" />
}
