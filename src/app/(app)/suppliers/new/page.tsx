import { redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function NewSupplierPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier.manage')) redirect('/suppliers')
  return <PartyForm kind="supplier" />
}
