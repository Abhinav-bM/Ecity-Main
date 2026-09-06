'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/utils'

export type ReceiptData = {
  receiptNumber: string
  receivedOn: Date | string
  amountPaise: bigint
  reference: string | null
  notes: string | null
  voidedAt: Date | string | null
  voidReason: string | null
  methodName: string
  branchName: string
  branchCode: string
  customerName: string
  customerPhone: string | null
  business: { name: string; addressLine1: string | null; city: string | null; phone: string | null }
  allocations: { id: number; invoiceNumber: string; amountPaise: bigint }[]
  advancePaise: bigint
  balanceAfterPaise: bigint
}

/**
 * The customer's proof of payment (PRD FR-26.2).
 *
 * Reuses the invoice's print pipeline — same #invoice id and the same A4 /
 * 80 mm handling — so a shop that has set its thermal printer up once does
 * not have to do it again for receipts.
 */
export function Receipt({ data }: { data: ReceiptData }) {
  const [busy, setBusy] = useState(false)

  function print(format: 'a4' | 'thermal') {
    setBusy(true)
    document.documentElement.setAttribute('data-print', format)
    requestAnimationFrame(() => {
      window.print()
      document.documentElement.removeAttribute('data-print')
      setBusy(false)
    })
  }

  return (
    <>
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => print('a4')}>
          Print A4
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => print('thermal')}>
          Print receipt (80 mm)
        </Button>
      </div>

      <div id="invoice" className="rounded-lg border bg-card p-6 text-sm">
        <header className="mb-4 border-b pb-3">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Payment receipt
          </p>
          <h2 className="text-base font-semibold">{data.business.name}</h2>
          {data.business.addressLine1 ? <p>{data.business.addressLine1}</p> : null}
          <p className="text-muted-foreground">
            {[data.business.city, data.business.phone].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.branchName} ({data.branchCode})
          </p>
        </header>

        {data.voidedAt ? (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs font-medium text-destructive">
            VOIDED — {data.voidReason}
          </p>
        ) : null}

        <div className="mb-3 flex flex-wrap justify-between gap-2">
          <div>
            <p className="font-mono font-medium">{data.receiptNumber}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(data.receivedOn)}</p>
          </div>
          <div className="text-right">
            <p className="font-medium">{data.customerName}</p>
            {data.customerPhone ? (
              <p className="text-xs text-muted-foreground">{data.customerPhone}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Received with thanks</p>
          <p className="tabular text-2xl font-semibold">{formatMoney(data.amountPaise)}</p>
          <p className="text-xs text-muted-foreground">
            by {data.methodName}
            {data.reference ? ` · ${data.reference}` : ''}
          </p>
        </div>

        {data.allocations.length > 0 ? (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium">Applied to</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[18rem] text-sm">
                <thead className="border-y">
                  <tr className="text-left text-xs uppercase">
                    <th className="py-1">Invoice</th>
                    <th className="py-1 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allocations.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-1.5 font-mono text-xs">{a.invoiceNumber}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(a.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {data.advancePaise > 0n ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {formatMoney(data.advancePaise)} held on account as an advance.
          </p>
        ) : null}

        <div className="mt-4 flex justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Balance after this receipt</span>
          <span className="tabular font-medium">{formatMoney(data.balanceAfterPaise)}</span>
        </div>

        {data.notes ? <p className="mt-2 text-xs text-muted-foreground">{data.notes}</p> : null}

        <footer className="mt-4 border-t pt-2 text-center text-[11px] text-muted-foreground">
          This receipt confirms money received, not delivery of goods.
        </footer>
      </div>
    </>
  )
}
