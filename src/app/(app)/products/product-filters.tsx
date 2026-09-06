'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/app-select'

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
      <AppSelect
          label="Product kind"
          className="w-full sm:w-48"
          value={kind === '' ? 'all' : kind}
          onValueChange={(v) => apply({ kind: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All products' },
            { value: 'mobile', label: 'Mobiles (IMEI)' },
            { value: 'accessory', label: 'Accessories' },
          ]}
        />
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
