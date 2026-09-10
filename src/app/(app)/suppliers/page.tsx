import { redirect } from 'next/navigation'
import { PartyList, type PartyRow } from '@/components/party-list'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listParties } from '@/server/services/party.service'
import { readPage } from '@/lib/list-view'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; includeInactive?: string; page?: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'supplier.view')) redirect('/dashboard')

  const params = await searchParams
  const page = readPage(params.page)
  const search = params.search ?? ''
  const includeInactive = params.includeInactive === '1'

  const { rows, total } = await listParties(session.user, 'supplier', {
    search,
    includeInactive,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <PartyList
      kind="supplier"
      rows={rows as PartyRow[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      canManage={hasPermission(session.user, 'supplier.manage')}
      search={search}
      includeInactive={includeInactive}
    />
  )
}
