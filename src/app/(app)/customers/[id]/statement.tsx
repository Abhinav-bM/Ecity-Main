import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
import type { customerStatement } from '@/server/services/customer-ledger.service'

const TYPE_LABEL: Record<string, string> = {
  OPENING: 'Opening balance',
  SALE: 'Invoice',
  PAYMENT: 'Payment',
  REVERSAL: 'Reversal',
  ADJUSTMENT: 'Adjustment',
}

/**
 * PRD FR-7.6 — the account, oldest first, with a running balance.
 *
 * This is what gets handed to a customer who disputes what they owe, so every
 * movement appears rather than a summary.
 */
export function Statement({
  statement,
}: {
  statement: Awaited<ReturnType<typeof customerStatement>>
}) {
  if (statement.lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No account activity yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="hidden sm:table-cell">Branch</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateShort(l.occurredAt)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={l.entryType === 'PAYMENT' ? 'success' : 'muted'}>
                        {TYPE_LABEL[l.entryType] ?? l.entryType}
                      </Badge>
                      {l.refType === 'sale' && l.refId ? (
                        <Link
                          href={`/sales/${l.refId}`}
                          className="font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {l.note}
                        </Link>
                      ) : l.refType === 'customer_payment' && l.refId ? (
                        <Link
                          href={`/receipts/${l.refId}`}
                          className="text-xs underline-offset-4 hover:underline"
                        >
                          {l.note ?? 'Receipt'}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">{l.note}</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {l.branchName ?? '—'}
                  </TableCell>
                  {/* Debit increases what they owe; credit reduces it. */}
                  <TableCell className="tabular text-right">
                    {l.amountPaise > 0n ? formatMoney(l.amountPaise) : '—'}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {l.amountPaise < 0n ? formatMoney(-l.amountPaise) : '—'}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatMoney(l.balancePaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex justify-end gap-4 text-sm">
        <span className="text-muted-foreground">Closing balance</span>
        <span
          className={`tabular font-semibold ${statement.closingBalancePaise > 0n ? 'text-destructive' : ''}`}
        >
          {formatMoney(statement.closingBalancePaise)}
          {statement.closingBalancePaise < 0n ? ' in credit' : ''}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Append-only: a correction is a new line, never an edit to an old one.
      </p>
    </div>
  )
}
