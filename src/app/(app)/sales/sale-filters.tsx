'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/app-select'
import { DateRangeField } from '@/components/date-field'
import { shopDateString } from '@/lib/date'

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

      <AppSelect
        label="Payment status"
        className="w-full sm:w-44"
        allowEmpty
        emptyLabel="Any status"
        placeholder="Any status"
        value={paymentStatus}
        onValueChange={(v) => apply({ paymentStatus: v || null })}
        options={[
          { value: 'PAID', label: 'Paid' },
          { value: 'PARTIAL', label: 'Partly paid' },
          { value: 'UNPAID', label: 'Unpaid' },
        ]}
      />

      <AppSelect
        label="Branch"
        className="w-full sm:w-48"
        allowEmpty
        emptyLabel="All branches"
        placeholder="All branches"
        value={branchId}
        onValueChange={(v) => apply({ branchId: v || null })}
        options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      />

      <DateRangeField
        from={from}
        to={to}
        max={shopDateString()}
        onApply={(r) => apply({ from: r.from || null, to: r.to || null })}
        className="w-full"
      />
    </form>
  )
}
