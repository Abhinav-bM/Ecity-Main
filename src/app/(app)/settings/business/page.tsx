import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  getBusiness,
  listExpenseCategories,
  listPaymentMethods,
  listTaxRates,
} from '@/server/services/business.service'
import { BusinessSettings } from './business-settings'

export const dynamic = 'force-dynamic'

export default async function BusinessSettingsPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'business.view')) redirect('/dashboard')

  const [business, taxRates, paymentMethods, expenseCategories] = await Promise.all([
    getBusiness(session.user),
    listTaxRates(session.user),
    listPaymentMethods(session.user),
    listExpenseCategories(session.user),
  ])

  return (
    <BusinessSettings
      business={business}
      taxRates={taxRates}
      paymentMethods={paymentMethods}
      expenseCategories={expenseCategories}
      canManage={hasPermission(session.user, 'business.manage')}
    />
  )
}
