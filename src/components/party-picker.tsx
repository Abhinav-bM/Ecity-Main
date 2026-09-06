'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type PickedParty = { id: number; name: string; phone: string | null }

/**
 * Searchable customer / supplier lookup.
 *
 * The same lesson as ProductPicker: a plain <select> capped at 500 silently
 * drops records, and the ones missing are invisible — the counter simply
 * cannot find the customer and has no way to know why. This queries as you
 * type, so the list size stops mattering.
 */
export function PartyPicker({
  kind,
  value,
  onSelect,
  label,
  id,
  placeholder,
  allowNone,
  noneLabel = 'None',
}: {
  kind: 'customer' | 'supplier'
  value: PickedParty | null
  onSelect: (party: PickedParty | null) => void
  label: string
  id?: string
  placeholder?: string
  /** Offer an explicit "no selection" row (a walk-in has no customer). */
  allowNone?: boolean
  noneLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PickedParty[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      if (query.trim()) params.set('search', query.trim())
      const res = await fetch(`/api/${kind}s?${params}`)
      if (cancelled) return
      const data = res.ok ? ((await res.json()) as { rows?: PickedParty[] }) : null
      setRows(data?.rows ?? [])
      setLoading(false)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, kind])

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
            {value ? value.name : (placeholder ?? `Search ${kind}s…`)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 size-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder="Name, phone, email or GST"
              value={query}
              onValueChange={setQuery}
              className="border-0 focus:ring-0"
            />
          </div>
          <CommandList data-testid={`${kind}-picker-list`}>
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">Searching…</div>
            ) : (
              <CommandEmpty>No {kind}s match.</CommandEmpty>
            )}
            <CommandGroup>
              {allowNone ? (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onSelect(null)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('mr-2 size-4', !value ? 'opacity-100' : 'opacity-0')} />
                  {noneLabel}
                </CommandItem>
              ) : null}
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
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.phone ? (
                    <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                      {p.phone}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
