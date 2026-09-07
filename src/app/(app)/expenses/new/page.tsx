import { redirect } from 'next/navigation'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import {
  listExpenseCategories,
  listPaymentMethods,
} from '@/server/services/business.service'
import { listAccounts } from '@/server/services/cash.service'
import { listBranches } from '@/server/services/branch.service'
import { ExpenseForm } from './expense-form'

export const dynamic = 'force-dynamic'

export default async function NewExpensePage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'expense.manage')) redirect('/expenses')

  const [categories, methods, accounts, branches] = await Promise.all([
    listExpenseCategories(session.user),
    listPaymentMethods(session.user),
    listAccounts(session.user),
    listBranches(session.user),
  ])

  return (
    <ExpenseForm
      categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))}
      paymentMethods={methods
        .filter((m) => m.isActive)
        .map((m) => ({ id: m.id, name: m.name, affectsCashDrawer: m.affectsCashDrawer }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
      canCorrectClosedDays={hasPermission(session.user, 'closing.correct')}
    />
  )
}
