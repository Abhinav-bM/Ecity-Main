import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Invoice } from '@/components/invoice'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getInvoiceData } from '@/server/services/invoice'
import { getSale } from '@/server/services/sale.service'

export const dynamic = 'force-dynamic'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'destructive' } as const

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'sale.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [detail, invoice] = await Promise.all([
    getSale(session.user, id),
    getInvoiceData(session.user, id),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/sales"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Sales
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
            {detail.sale.invoiceNumber}
          </h1>
        </div>
        <Badge variant={PAY_VARIANT[detail.paymentStatus]}>{detail.paymentStatus}</Badge>
      </div>

      <Invoice saleId={id} data={invoice} />
    </div>
  )
}
