import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { orNotFound } from '@/server/page-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
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

  const canCollect = hasPermission(session.user, 'customer_payment.manage')

  const [detail, invoice] = await orNotFound(Promise.all([
    getSale(session.user, id),
    getInvoiceData(session.user, id),
  ]))

  const overdue =
    detail.sale.dueDate != null && detail.sale.dueDate.getTime() < Date.now()

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
        <div className="flex items-center gap-2">
          <Badge variant={PAY_VARIANT[detail.paymentStatus]}>{detail.paymentStatus}</Badge>
          {detail.sale.status === 'COMPLETED' && hasPermission(session.user, 'return.create') ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/returns/new?saleId=${id}`}>Take a return</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        PRD FR-7.2. The terms were agreed at the counter, so they belong on the
        bill - otherwise nobody can see when the money is due without going to
        the dues screen and working it out.
      */}
      {detail.paymentStatus !== 'PAID' ? (
        <Card className="no-print">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-muted-foreground">
                Outstanding{' '}
                <span
                  className={`tabular font-semibold ${overdue ? 'text-destructive' : 'text-foreground'}`}
                >
                  {formatMoney(detail.sale.totalPaise - detail.paidPaise)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {detail.sale.dueDate ? (
                  <>
                    Due {formatDateShort(detail.sale.dueDate)}
                    {overdue ? ' — overdue' : ''}
                  </>
                ) : (
                  'No due date agreed'
                )}
                {detail.sale.creditNotes ? ` · ${detail.sale.creditNotes}` : ''}
              </p>
            </div>
            {detail.sale.customerId && canCollect ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/customers/${detail.sale.customerId}/collect`}>Collect payment</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Invoice saleId={id} data={invoice} />
    </div>
  )
}
