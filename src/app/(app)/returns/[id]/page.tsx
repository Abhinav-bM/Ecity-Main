import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getSessionContext } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getReturn } from '@/server/services/return.service'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  if (!hasPermission(session.user, 'return.view')) redirect('/dashboard')

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const r = await getReturn(session.user, id)
  const net = r.salesReturn.totalPaise - r.salesReturn.deductionPaise

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/returns"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Returns
          </Link>
          <h1 className="mt-1 font-mono text-lg font-semibold tracking-tight sm:text-xl">
            {r.salesReturn.returnNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(r.salesReturn.returnedAt)} · {r.branchName} · against{' '}
            <Link href={`/sales/${r.salesReturn.saleId}`} className="underline underline-offset-4">
              {r.invoiceNumber}
            </Link>
          </p>
        </div>
        <Badge variant={r.salesReturn.voidedAt ? 'destructive' : 'muted'}>
          {r.salesReturn.voidedAt ? 'Voided' : r.salesReturn.returnType}
        </Badge>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What came back</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.description}
                    {i.identifierSnapshot ? (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {i.identifierSnapshot}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{i.quantity}</TableCell>
                  <TableCell className="tabular text-right">
                    {formatMoney(i.lineTotalPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <CardContent className="pt-3">
          <dl className="ml-auto grid w-56 grid-cols-2 gap-0.5 text-sm">
            <dt className="text-muted-foreground">Goods</dt>
            <dd className="tabular text-right">{formatMoney(r.salesReturn.totalPaise)}</dd>
            {r.salesReturn.deductionPaise > 0n ? (
              <>
                <dt className="text-muted-foreground">Deduction</dt>
                <dd className="tabular text-right">
                  −{formatMoney(r.salesReturn.deductionPaise)}
                </dd>
              </>
            ) : null}
            <dt className="border-t pt-1 font-medium">Owed back</dt>
            <dd className="tabular border-t pt-1 text-right font-medium">{formatMoney(net)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Money</CardTitle>
        </CardHeader>
        <CardContent>
          {r.refunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No refund recorded. The value came off what the customer owes.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              {r.refunds.map((f) => (
                <div key={f.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {f.method === 'CUSTOMER_ACCOUNT'
                      ? 'Credited to their account'
                      : `Paid back by ${f.methodName}`}
                    {f.reference ? ` · ${f.reference}` : ''}
                  </span>
                  <span className="tabular font-medium">{formatMoney(f.amountPaise)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {r.salesReturn.reason ? (
        <p className="text-sm text-muted-foreground">Reason: {r.salesReturn.reason}</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Any handsets on this return are in the inspection queue and are not sellable until graded.
      </p>
    </div>
  )
}
