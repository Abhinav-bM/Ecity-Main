'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type PickedProduct = {
  id: number
  name: string
  sku: string | null
  isSerialised: boolean
  identifierType: 'IMEI' | 'SERIAL' | 'NONE'
  /** Whether the category wants a serial beside the IMEI (FR-4.8). */
  capturesSerial: boolean
  quantity: number
  purchasePricePaise: string | null
  sellingPricePaise: string | null
}

/**
 * Searchable product lookup.
 *
 * A plain <select> of the whole catalogue does not scale: capped at 500 it
 * silently dropped products, and a shop with a few thousand SKUs would simply
 * not find what it wanted. This queries the server as you type.
 */
export function ProductPicker({
  value,
  onSelect,
  serialisedOnly,
  label = 'Product',
  id,
  onCreateNew,
}: {
  value: PickedProduct | null
  onSelect: (product: PickedProduct) => void
  serialisedOnly?: boolean
  label?: string
  id?: string
  /*
   * A way out when the catalogue has never heard of what is being booked in.
   * What was typed is handed over so it need not be typed again.
   */
  onCreateNew?: (query: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PickedProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (serialisedOnly) params.set('serialised', 'true')
      const res = await fetch(`/api/products/search?${params}`)
      if (cancelled) return
      setRows(res.ok ? ((await res.json()) as PickedProduct[]) : [])
      setLoading(false)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, serialisedOnly])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? value.name : 'Search products…'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 size-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder="Name, SKU or barcode"
              value={query}
              onValueChange={setQuery}
              className="border-0 focus:ring-0"
            />
          </div>
          <CommandList data-testid="product-picker-list">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">Searching…</div>
            ) : rows.length === 0 ? (
              // Not <CommandEmpty>: with a create row below there is an item
              // in the list, and cmdk would judge the list non-empty.
              <div className="px-3 py-2 text-sm text-muted-foreground">No products match.</div>
            ) : null}
            <CommandGroup>
              {rows.map((p) => (
                <CommandItem
                  key={p.id}
                  value={String(p.id)}
                  onSelect={() => {
                    onSelect(p)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn('mr-2 size-4', value?.id === p.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.sku ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{p.sku}</span>
                    ) : null}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {p.isSerialised ? p.identifierType : `${p.quantity} in stock`}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateNew && !loading && query.trim() ? (
              <CommandGroup className="border-t">
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    onCreateNew(query.trim())
                    setOpen(false)
                  }}
                >
                  <Plus className="mr-2 size-4" />
                  <span className="truncate">Add “{query.trim()}” as a new product</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
