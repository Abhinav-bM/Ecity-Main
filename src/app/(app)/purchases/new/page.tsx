import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAccessibleBranches } from '@/server/services/branch.service'
import {
  getBusiness,
  listPaymentMethods,
  listTaxRates,
} from '@/server/services/business.service'
import { PurchaseForm } from './purchase-form'

export const dynamic = 'force-dynamic'

export default async function NewPurchasePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'purchase.manage')) redirect('/purchases')

  // Products and suppliers are searched from their pickers rather than loaded
  // up front, so neither list can outgrow a fixed page size.
  const [branches, taxRates, business, paymentMethods] = await Promise.all([
    listAccessibleBranches(session.user),
    listTaxRates(session.user),
    getBusiness(session.user),
    listPaymentMethods(session.user),
  ])

  return (
    <PurchaseForm
      branches={branches}
      /*
       * For the quick-create product dialog. A product added from a purchase
       * line used to be saved with no tax rate at all, so the first bill for
       * it silently carried whatever the shop default was - or no GST.
       */
      taxRates={taxRates.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }))}
      gstEnabled={business.gstEnabled}
      /*
       * For settling the bill as it is entered. Without `supplier_payment.manage`
       * the block is not offered at all - it would only ever 403.
       */
      paymentMethods={paymentMethods
        .filter((m) => m.isActive)
        .map((m) => ({ id: m.id, name: m.name }))}
      canPay={hasPermission(session.user, 'supplier_payment.manage')}
      canCreateProduct={hasPermission(session.user, 'product.manage')}
      canCreateSupplier={hasPermission(session.user, 'supplier.manage')}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
    />
  )
}
