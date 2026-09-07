'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Without this the list is paginated and unsearchable, so a shop with a few
 * hundred suppliers cannot reach one that is not in the top 25 by amount owed.
 */
export function DuesSearch({ search }: { search: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [term, setTerm] = useState(search)
  const [pending, startTransition] = useTransition()

  return (
    <form
      data-testid="supplier-dues-search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const q = new URLSearchParams(params.toString())
        if (term.trim()) q.set('search', term.trim())
        else q.delete('search')
        q.delete('page')
        startTransition(() => router.push(`/purchases/supplier-dues?${q.toString()}`))
      }}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-8"
          aria-label="Search suppliers"
          placeholder="Supplier name, company or phone"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        Search
      </Button>
    </form>
  )
}
