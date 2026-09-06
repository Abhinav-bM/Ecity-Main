'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MainTypeBadge } from '@/components/main-type-badge'
import { formatMoney } from '@/lib/money'
import type { MainType } from '@/server/db/schema'

export type DeviceHit = {
  deviceId: number
  identifier: string | null
  productId: number
  productName: string
  mainType: MainType
  isNewCut: boolean
  sellingPricePaise: string | null
  taxRateId: number | null
  colour: string | null
  storage: string | null
  batteryHealthPercent: number | null
}

export type ProductHit = {
  productId: number
  productName: string
  sku: string | null
  sellingPricePaise: string | null
  taxRateId: number | null
  quantity: number
}

/**
 * The counter's search box (PRD FR-6.1).
 *
 * Scanner-first: a barcode reader types fast and ends with Enter. A full
 * identifier match is added straight to the bill, so twenty items is twenty
 * scans with no mouse.
 */
export function BillSearch({
  branchId,
  onPickDevice,
  onPickProduct,
}: {
  branchId: number
  onPickDevice: (hit: DeviceHit) => void
  onPickProduct: (hit: ProductHit) => void
}) {
  const [query, setQuery] = useState('')
  const [devices, setDevices] = useState<DeviceHit[]>([])
  const [products, setProducts] = useState<ProductHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setDevices([])
      setProducts([])
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/billing/search?q=${encodeURIComponent(query.trim())}&branchId=${branchId}`,
      )
      if (cancelled) return
      if (res.ok) {
        const data = (await res.json()) as { devices: DeviceHit[]; products: ProductHit[] }
        setDevices(data.devices)
        setProducts(data.products)
      }
      setLoading(false)
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, branchId])

  function take(pick: () => void) {
    pick()
    setQuery('')
    setDevices([])
    setProducts([])
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          className="h-11 pl-9 text-base"
          placeholder="Scan an IMEI or search a product…"
          aria-label="Scan or search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            // A scanner ends with Enter. One exact hit goes straight on the
            // bill; otherwise the list stays open for a decision.
            const only = devices.length === 1 && products.length === 0
            if (only) take(() => onPickDevice(devices[0]!))
            else if (products.length === 1 && devices.length === 0) {
              take(() => onPickProduct(products[0]!))
            }
          }}
        />
      </div>

      {loading || devices.length > 0 || products.length > 0 ? (
        <Card className="max-h-80 divide-y overflow-y-auto" data-testid="bill-search-results">
          {loading && devices.length === 0 && products.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          ) : null}

          {devices.map((d) => (
            <button
              key={d.deviceId}
              type="button"
              className="flex w-full items-center gap-3 p-3 text-left text-sm hover:bg-accent"
              onClick={() => take(() => onPickDevice(d))}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs">{d.identifier}</span>
                <span className="block truncate text-muted-foreground">
                  {d.productName}
                  {d.storage ? ` · ${d.storage}` : ''}
                  {d.colour ? ` · ${d.colour}` : ''}
                  {d.batteryHealthPercent != null ? ` · battery ${d.batteryHealthPercent}%` : ''}
                </span>
              </span>
              <MainTypeBadge mainType={d.mainType} isNewCut={d.isNewCut} />
              <span className="tabular shrink-0 font-medium">
                {formatMoney(d.sellingPricePaise ? BigInt(d.sellingPricePaise) : null)}
              </span>
            </button>
          ))}

          {products.map((p) => (
            <button
              key={p.productId}
              type="button"
              className="flex w-full items-center gap-3 p-3 text-left text-sm hover:bg-accent"
              onClick={() => take(() => onPickProduct(p))}
              disabled={p.quantity <= 0}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.productName}</span>
                {p.sku ? (
                  <span className="block font-mono text-xs text-muted-foreground">{p.sku}</span>
                ) : null}
              </span>
              <Badge variant={p.quantity > 0 ? 'muted' : 'destructive'}>
                {p.quantity > 0 ? `${p.quantity} in stock` : 'Out of stock'}
              </Badge>
              <span className="tabular shrink-0 font-medium">
                {formatMoney(p.sellingPricePaise ? BigInt(p.sellingPricePaise) : null)}
              </span>
            </button>
          ))}
        </Card>
      ) : null}
    </div>
  )
}
