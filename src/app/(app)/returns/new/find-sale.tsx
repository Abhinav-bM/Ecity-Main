'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { formatDateShort } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

type Hit = {
  id: number
  invoiceNumber: string
  soldAt: string
  totalPaise: string
  customerName: string | null
  branchName: string
}

/**
 * PRD FR-8.1. One box, three ways in.
 *
 * The sales search already matches invoice number, customer name and IMEI, so
 * the salesperson types whatever the customer has in front of them rather than
 * choosing a mode first.
 */
export function FindSale() {
  const router = useRouter()
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function search() {
    if (!term.trim()) return
    setBusy(true)
    const res = await apiFetch(`/api/sales?search=${encodeURIComponent(term.trim())}&pageSize=10`)
    setBusy(false)
    const data = res.ok ? ((res.data) as { rows?: Hit[] }) : null
    setHits(data?.rows ?? [])
  }

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            type="search"
            className="pl-8"
            aria-label="Find the bill"
            placeholder="Invoice number, customer name, or IMEI"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Find'}
        </Button>
      </form>

      {hits === null ? null : hits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No bill matches that.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="sale-hits">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left text-sm hover:bg-accent"
              onClick={() => router.push(`/returns/new?saleId=${h.id}`)}
            >
              <div className="min-w-0">
                <p className="font-mono text-xs">{h.invoiceNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateShort(h.soldAt)} · {h.customerName ?? 'Walk-in'} · {h.branchName}
                </p>
              </div>
              <span className="tabular font-medium">{formatMoney(BigInt(h.totalPaise))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
