import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getParty } from '@/server/services/party.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { listPaymentMethods } from '@/server/services/business.service'
import { openSalesForCustomer } from '@/server/services/customer-payment.service'
import { customerBalance } from '@/server/services/customer-ledger.service'
import { formatMoney } from '@/lib/money'
import { CollectForm } from './collect-form'

export const dynamic = 'force-dynamic'

/** PRD FR-7.3 — take money against one or many open bills. */
export default async function CollectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer_payment.manage')) redirect('/customers')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [party, openSales, branches, methods, balance] = await orNotFound(Promise.all([
    getParty(session.user, 'customer', id),
    openSalesForCustomer(session.user, id),
    listAccessibleBranches(session.user),
    listPaymentMethods(session.user),
    customerBalance(id),
  ]))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href={`/customers/${id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {party.name}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">Collect payment</h1>
        <p className="text-sm text-muted-foreground">
          Account balance {formatMoney(balance)}
          {balance < 0n ? ' (in credit)' : ''}
        </p>
      </div>

      <CollectForm
        customerId={id}
        customerName={party.name}
        openSales={openSales}
        branches={branches}
        methods={methods.map((m) => ({ id: m.id, name: m.name }))}
        defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
      />
    </div>
  )
}
