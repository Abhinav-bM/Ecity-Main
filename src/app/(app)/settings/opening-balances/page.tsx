import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listBranches } from '@/server/services/branch.service'
import { listAccounts } from '@/server/services/cash.service'
import { openingSummary } from '@/server/services/opening-balance.service'
import { shopDateString } from '@/lib/date'
import { OpeningBalances } from './opening-balances'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-34.1 – FR-34.3. What the shop already had on the day it starts.
 *
 * A shop does not open its doors on day one: there is stock on the shelf,
 * cash in the till and people who already owe money. None of it has a
 * document behind it, so it cannot arrive down the ordinary path — but it
 * must land in the same ledgers, or every figure built on them starts wrong.
 */
export default async function OpeningBalancesPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'product.manage')) redirect('/dashboard')

  const [branches, accounts, summary] = await Promise.all([
    listBranches(session.user),
    listAccounts(session.user),
    openingSummary(session.user),
  ])

  return (
    <OpeningBalances
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name, branchName: a.branchName }))}
      summary={summary}
      today={shopDateString()}
    />
  )
}
