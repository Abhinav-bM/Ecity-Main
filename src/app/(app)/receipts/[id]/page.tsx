import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getBusiness } from '@/server/services/business.service'
import { getCustomerPayment } from '@/server/services/customer-payment.service'
import { customerBalance } from '@/server/services/customer-ledger.service'
import { Receipt } from './receipt'
import { VoidReceiptButton } from './void-button'

export const dynamic = 'force-dynamic'

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'customer_payment.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [detail, business] = await Promise.all([
    getCustomerPayment(session.user, id),
    getBusiness(session.user),
  ])
  const balance = await customerBalance(detail.payment.customerId)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/customers/${detail.payment.customerId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← {detail.customerName}
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
            {detail.payment.receiptNumber}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {detail.payment.voidedAt ? <Badge variant="destructive">Voided</Badge> : null}
          {!detail.payment.voidedAt &&
          hasPermission(session.user, 'customer_payment.void') ? (
            <VoidReceiptButton id={id} receiptNumber={detail.payment.receiptNumber} />
          ) : null}
        </div>
      </div>

      <Receipt
        data={{
          receiptNumber: detail.payment.receiptNumber,
          receivedOn: detail.payment.receivedOn,
          amountPaise: detail.payment.amountPaise,
          reference: detail.payment.reference,
          notes: detail.payment.notes,
          voidedAt: detail.payment.voidedAt,
          voidReason: detail.payment.voidReason,
          methodName: detail.methodName,
          branchName: detail.branchName,
          branchCode: detail.branchCode,
          customerName: detail.customerName,
          customerPhone: detail.customerPhone,
          business: {
            name: business.name,
            addressLine1: business.addressLine1,
            city: business.city,
            phone: business.phone,
          },
          allocations: detail.allocations,
          advancePaise: detail.advancePaise,
          balanceAfterPaise: balance,
        }}
      />
    </div>
  )
}
