'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto'

export function DuesFilters({
  branches,
}: {
  branches: { id: number; code: string; name: string }[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [term, setTerm] = useState(params.get('search') ?? '')

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    startTransition(() => router.push(`/customers/dues?${q.toString()}`))
  }

  return (
    <form
      data-testid="dues-filters"
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        apply({ search: term })
      }}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-8"
          placeholder="Customer name or phone"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search customers"
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        Search
      </Button>

      <select
        className={selectClass}
        aria-label="Branch"
        value={params.get('branchId') ?? ''}
        onChange={(e) => apply({ branchId: e.target.value || null })}
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        aria-label="Show"
        value={params.get('overdue') === '1' ? '1' : ''}
        onChange={(e) => apply({ overdue: e.target.value || null })}
      >
        <option value="">Everything owed</option>
        <option value="1">Overdue only</option>
      </select>

      {/* Bounds the collections column only; what is owed is owed today. */}
      <Input
        type="date"
        className="w-auto"
        aria-label="Collected from"
        value={params.get('from') ?? ''}
        onChange={(e) => apply({ from: e.target.value || null })}
      />
      <Input
        type="date"
        className="w-auto"
        aria-label="Collected to"
        value={params.get('to') ?? ''}
        onChange={(e) => apply({ to: e.target.value || null })}
      />
    </form>
  )
}
