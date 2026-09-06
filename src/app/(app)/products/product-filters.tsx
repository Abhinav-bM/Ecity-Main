'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ProductFilters({
  search,
  kind,
  includeInactive,
}: {
  search: string
  kind: string
  includeInactive: boolean
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
    startTransition(() => router.push(`/products?${q.toString()}`))
  }

  return (
    <form
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
          placeholder="Name, SKU or barcode"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search products"
        />
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Product kind"
        value={kind}
        onChange={(e) => apply({ kind: e.target.value })}
      >
        <option value="">All products</option>
        <option value="mobile">Mobiles (IMEI)</option>
        <option value="accessory">Accessories</option>
      </select>
      <Button
        type="button"
        variant={includeInactive ? 'default' : 'outline'}
        onClick={() => apply({ includeInactive: includeInactive ? null : '1' })}
      >
        {includeInactive ? 'Hiding none' : 'Show inactive'}
      </Button>
    </form>
  )
}
