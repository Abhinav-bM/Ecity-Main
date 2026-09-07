import { redirect } from 'next/navigation'
import { PartyForm } from '@/components/party-form'
import { getBusiness } from '@/server/services/business.service'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function NewSupplierPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier.manage')) redirect('/suppliers')
  const business = await getBusiness(session.user)
  return <PartyForm kind="supplier" gstEnabled={business.gstEnabled} />
}
