'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { MAIN_TYPE_LABEL } from '@/components/main-type-badge'
import type { MainType } from '@/server/db/schema'

export type InvoiceData = {
  invoiceNumber: string
  soldAt: Date | string
  pricesIncludedTax: boolean
  business: {
    name: string
    addressLine1: string | null
    city: string | null
    phone: string | null
    gstin: string | null
  }
  branch: { name: string; code: string }
  customer: { name: string; phone: string | null; gstin: string | null } | null
  items: {
    id: number
    description: string | null
    identifierSnapshot: string | null
    mainTypeSnapshot: MainType | null
    isNewCutSnapshot: boolean
    quantity: number
    unitPricePaise: bigint
    discountPaise: bigint
    taxRateBasisPoints: number
    taxablePaise: bigint
    taxPaise: bigint
    lineTotalPaise: bigint
  }[]
  payments: { id: number; methodName: string; amountPaise: bigint; reference: string | null }[]
  subtotalPaise: bigint
  discountPaise: bigint
  taxablePaise: bigint
  taxPaise: bigint
  totalPaise: bigint
  paidPaise: bigint
}

/**
 * The invoice (PRD FR-26.1, FR-26.4).
 *
 * One document, two print formats: A4 for a filed copy and 80 mm for the
 * counter's thermal printer. Printing is the browser's own pipeline, which
 * avoids running headless Chrome on the server (docs/03 §5).
 */
export function Invoice({ data, saleId }: { data: InvoiceData; saleId: number }) {
  const [busy, setBusy] = useState(false)

  function print(format: 'a4' | 'thermal') {
    setBusy(true)
    document.documentElement.setAttribute('data-print', format)
    // Let the layout settle before the print dialog snapshots it.
    requestAnimationFrame(() => {
      window.print()
      document.documentElement.removeAttribute('data-print')
      setBusy(false)
    })
  }

  const taxByRate = new Map<number, { taxable: bigint; tax: bigint }>()
  for (const i of data.items) {
    const bucket = taxByRate.get(i.taxRateBasisPoints) ?? { taxable: 0n, tax: 0n }
    bucket.taxable += i.taxablePaise
    bucket.tax += i.taxPaise
    taxByRate.set(i.taxRateBasisPoints, bucket)
  }
  const due = data.totalPaise - data.paidPaise

  return (
    <>
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => print('a4')}>
          Print A4
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => print('thermal')}>
          Print receipt (80 mm)
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/sales/${saleId}/pdf`}>Download PDF</a>
        </Button>
      </div>

      <div id="invoice" className="rounded-lg border bg-card p-6 text-sm">
        <header className="mb-4 border-b pb-3">
          <h2 className="text-base font-semibold">{data.business.name}</h2>
          {data.business.addressLine1 ? <p>{data.business.addressLine1}</p> : null}
          <p className="text-muted-foreground">
            {[data.business.city, data.business.phone].filter(Boolean).join(' · ')}
          </p>
          {data.business.gstin ? <p className="font-mono text-xs">GSTIN {data.business.gstin}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {data.branch.name} ({data.branch.code})
          </p>
        </header>

        <div className="mb-3 flex flex-wrap justify-between gap-2">
          <div>
            <p className="font-mono font-medium">{data.invoiceNumber}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(data.soldAt)}</p>
          </div>
          <div className="text-right">
            <p className="font-medium">{data.customer?.name ?? 'Walk-in customer'}</p>
            {data.customer?.phone ? (
              <p className="text-xs text-muted-foreground">{data.customer.phone}</p>
            ) : null}
            {data.customer?.gstin ? (
              <p className="font-mono text-xs">GSTIN {data.customer.gstin}</p>
            ) : null}
          </div>
        </div>

        <table className="w-full">
          <thead className="border-y">
            <tr className="text-left text-xs uppercase">
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Price</th>
              <th className="a4-only py-1 text-right">Tax</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id} className="border-b align-top">
                <td className="py-1.5">
                  {i.description}
                  {i.identifierSnapshot ? (
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {i.identifierSnapshot}
                    </span>
                  ) : null}
                  {i.mainTypeSnapshot ? (
                    <span className="block text-[11px] text-muted-foreground">
                      {MAIN_TYPE_LABEL[i.mainTypeSnapshot]}
                      {i.isNewCutSnapshot ? ' · NEW CUT' : ''}
                    </span>
                  ) : null}
                </td>
                <td className="tabular py-1.5 text-right">{i.quantity}</td>
                <td className="tabular py-1.5 text-right">{formatMoney(i.unitPricePaise)}</td>
                <td className="a4-only tabular py-1.5 text-right">{formatMoney(i.taxPaise)}</td>
                <td className="tabular py-1.5 text-right">{formatMoney(i.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <dl className="grid w-56 grid-cols-2 gap-0.5">
            <dt className="text-muted-foreground">Taxable</dt>
            <dd className="tabular text-right">{formatMoney(data.taxablePaise)}</dd>
            {[...taxByRate.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([bp, v]) => (
                <div key={bp} className="col-span-2 grid grid-cols-2 gap-0.5">
                  <dt className="text-muted-foreground">GST {bp / 100}%</dt>
                  <dd className="tabular text-right">{formatMoney(v.tax)}</dd>
                </div>
              ))}
            <dt className="border-t pt-1 font-medium">Total</dt>
            <dd className="tabular border-t pt-1 text-right font-medium">
              {formatMoney(data.totalPaise)}
            </dd>
            {data.payments.map((p) => (
              <div key={p.id} className="col-span-2 grid grid-cols-2 gap-0.5">
                <dt className="text-muted-foreground">{p.methodName}</dt>
                <dd className="tabular text-right">{formatMoney(p.amountPaise)}</dd>
              </div>
            ))}
            {due > 0n ? (
              <>
                <dt className="font-medium">Balance due</dt>
                <dd className="tabular text-right font-medium">{formatMoney(due)}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <footer className="mt-4 border-t pt-2 text-center text-[11px] text-muted-foreground">
          {data.pricesIncludedTax ? 'Prices include GST.' : 'GST added as shown.'} Thank you.
        </footer>
      </div>
    </>
  )
}
