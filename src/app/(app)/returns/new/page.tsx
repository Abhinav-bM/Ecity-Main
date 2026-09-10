import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Alert } from '@/components/ui/alert'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { listAccessibleBranches } from '@/server/services/branch.service'
import { listPaymentMethods } from '@/server/services/business.service'
import { returnableLines } from '@/server/services/return.service'
import { getSale } from '@/server/services/sale.service'
import { ReturnForm } from './return-form'
import { FindSale } from './find-sale'

export const dynamic = 'force-dynamic'

/** PRD FR-8.1. Return by invoice, customer or IMEI. */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ saleId?: string }>
}) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'return.create')) redirect('/dashboard')

  const { saleId } = await searchParams

  // No bill chosen yet: offer the three ways of finding one.
  if (!saleId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Take a return</h1>
          <p className="text-sm text-muted-foreground">
            Find the bill by its number, the customer, or the IMEI on the handset.
          </p>
        </div>
        <FindSale />
      </div>
    )
  }

  const id = Number(saleId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [detail, { lines }, branches, methods] = await Promise.all([
    getSale(session.user, id),
    returnableLines(session.user, id),
    listAccessibleBranches(session.user),
    listPaymentMethods(session.user),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href={`/sales/${id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {detail.sale.invoiceNumber}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">Take a return</h1>
      </div>

      {detail.sale.status !== 'COMPLETED' ? (
        <Alert variant="destructive">That bill is not open for returns.</Alert>
      ) : (
        <ReturnForm
          saleId={id}
          invoiceNumber={detail.sale.invoiceNumber}
          customerName={detail.customerName}
          lines={lines}
          branches={branches}
          // Active only. A retired method must not be offered for a new
          // refund - and because the list is ordered by sortOrder, a
          // deactivated method could sort first and become the default,
          // which the server then rightly refuses as BAD_METHOD.
          methods={methods.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }))}
          defaultBranchId={session.activeBranchId ?? branches[0]?.id ?? null}
          canRefund={hasPermission(session.user, 'return.refund')}
        />
      )}
    </div>
  )
}
