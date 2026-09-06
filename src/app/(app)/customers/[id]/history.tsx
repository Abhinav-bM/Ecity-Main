import Link from 'next/link'
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
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
import type { getCustomerHistory } from '@/server/services/sale.service'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'destructive' } as const

/** PRD FR-6.7. What they have bought, and what they still owe. */
export function CustomerHistory({
  history,
}: {
  history: Awaited<ReturnType<typeof getCustomerHistory>>
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total spend" value={formatMoney(history.totalSpentPaise)} />
        <Stat label="Purchases" value={String(history.saleCount)} />
        <Stat
          label="Outstanding"
          value={formatMoney(history.outstandingPaise)}
          tone={history.outstandingPaise > 0n ? 'due' : undefined}
        />
        <Stat
          label="Last purchase"
          value={history.lastPurchaseAt ? formatDateShort(history.lastPurchaseAt) : '—'}
        />
      </div>

      {history.sales.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing bought yet. Sales billed to this customer will appear here.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cards on a phone, a table once there is room for one. */}
          <div className="grid gap-3 md:hidden" data-testid="customer-history-cards">
            {history.sales.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/sales/${s.id}`} className="font-mono underline-offset-4 hover:underline">
                      {s.invoiceNumber}
                    </Link>
                    <StatusBadge sale={s} />
                  </div>
                  <p className="text-muted-foreground">
                    {formatDateShort(s.soldAt)} · {s.branchName} · {s.itemCount} item
                    {s.itemCount === 1 ? '' : 's'}
                  </p>
                  <p className="tabular font-medium">{formatMoney(s.totalPaise)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="customer-history-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/sales/${s.id}`} className="underline-offset-4 hover:underline">
                        {s.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateShort(s.soldAt)}</TableCell>
                    <TableCell>{s.branchName}</TableCell>
                    <TableCell className="tabular text-right">{s.itemCount}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(s.totalPaise)}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(s.paidPaise)}</TableCell>
                    <TableCell>
                      <StatusBadge sale={s} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Payments against dues are on the Statement and Receipts tabs. Returns and
        exchanges arrive with M6.
      </p>
    </div>
  )
}

function StatusBadge({ sale }: { sale: { status: string; paymentStatus: keyof typeof PAY_VARIANT } }) {
  if (sale.status === 'VOIDED') return <Badge variant="outline">Voided</Badge>
  return <Badge variant={PAY_VARIANT[sale.paymentStatus]}>{sale.paymentStatus}</Badge>
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'due' }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-lg font-semibold ${tone === 'due' ? 'text-destructive' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
