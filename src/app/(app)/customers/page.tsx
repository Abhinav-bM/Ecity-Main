import { redirect } from 'next/navigation'
import { PartyList, type PartyRow } from '@/components/party-list'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listParties } from '@/server/services/party.service'

export const dynamic = 'force-dynamic'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; includeInactive?: string; page?: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer.view')) redirect('/dashboard')

  const params = await searchParams
  const search = params.search ?? ''
  const includeInactive = params.includeInactive === '1'

  const { rows, total } = await listParties(session.user, 'customer', {
    search,
    includeInactive,
    page: Math.max(1, Number(params.page ?? '1') || 1),
    pageSize: 25,
  })

  return (
    <PartyList
      kind="customer"
      rows={rows as PartyRow[]}
      total={total}
      canManage={hasPermission(session.user, 'customer.manage')}
      search={search}
      includeInactive={includeInactive}
    />
  )
}
