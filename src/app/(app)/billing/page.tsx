import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listParties } from '@/server/services/party.service'
import { listPaymentMethods, listTaxRates } from '@/server/services/business.service'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { BillingScreen } from './billing-screen'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'sale.create')) redirect('/dashboard')

  const branches = await listAccessibleBranches(session.user)
  const branchId = session.activeBranchId ?? branches[0]?.id ?? null

  // Billing always happens at one branch: stock, cash and the invoice series
  // all belong to it, so a consolidated view cannot take a payment.
  if (!branchId) {
    return (
      <Card className="mx-auto max-w-lg p-10 text-center">
        <p className="text-sm font-medium">Choose a branch to start billing.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A bill belongs to one branch — its stock, its cash drawer, its invoice series. Pick one
          from the branch switcher above.
        </p>
      </Card>
    )
  }

  const [customers, methods, rates] = await Promise.all([
    listParties(session.user, 'customer', { page: 1, pageSize: 500 }),
    listPaymentMethods(session.user),
    listTaxRates(session.user),
  ])

  return (
    <BillingScreen
      branchId={branchId}
      branchName={branches.find((b) => b.id === branchId)?.name ?? 'Branch'}
      customers={customers.rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
      paymentMethods={methods.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }))}
      defaultTaxRateId={rates.find((r) => r.isDefault)?.id ?? null}
      taxRates={rates.map((r) => ({ id: r.id, rateBasisPoints: r.rateBasisPoints }))}
      canDiscount={hasPermission(session.user, 'sale.discount')}
      canCreateCustomer={hasPermission(session.user, 'customer.manage')}
    />
  )
}
