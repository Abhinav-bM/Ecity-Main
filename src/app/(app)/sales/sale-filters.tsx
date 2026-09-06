'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function SaleFilters({
  search,
  paymentStatus,
  branchId,
  from,
  to,
  branches,
}: {
  search: string
  paymentStatus: string
  branchId: string
  from: string
  to: string
  branches: { id: number; name: string }[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [term, setTerm] = useState(search)
  const [, startTransition] = useTransition()

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    q.delete('page')
    startTransition(() => router.push(`/sales?${q.toString()}`))
  }

  return (
    <form
      data-testid="sale-filters"
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        apply({ search: term })
      }}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          type="search"
          placeholder="Invoice, customer or IMEI"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search sales"
        />
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>

      <select
        className={selectClass}
        aria-label="Payment status"
        value={paymentStatus}
        onChange={(e) => apply({ paymentStatus: e.target.value })}
      >
        <option value="">Any payment</option>
        <option value="PAID">Paid</option>
        <option value="PARTIAL">Partly paid</option>
        <option value="UNPAID">Unpaid</option>
      </select>

      <select
        className={selectClass}
        aria-label="Branch"
        value={branchId}
        onChange={(e) => apply({ branchId: e.target.value })}
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      <Input
        type="date"
        className="w-auto"
        aria-label="From date"
        value={from}
        onChange={(e) => apply({ from: e.target.value })}
      />
      <Input
        type="date"
        className="w-auto"
        aria-label="To date"
        value={to}
        onChange={(e) => apply({ to: e.target.value })}
      />
    </form>
  )
}
