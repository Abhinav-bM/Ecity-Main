'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeviceStatusBadge, MainTypeBadge } from '@/components/main-type-badge'
import { formatMoney } from '@/lib/money'
import { MAIN_TYPES } from '@/lib/validation'
import type { MainType } from '@/server/db/schema'

type Row = {
  id: number
  primaryIdentifier: string | null
  productName: string
  brandName: string | null
  variant: string | null
  storage: string | null
  colour: string | null
  batteryHealthPercent: number | null
  mainType: MainType
  isNewCut: boolean
  status: string
  branchName: string | null
  branchCode: string | null
  sellingPricePaise: bigint | null
  purchasePricePaise: bigint | null
}

export function DeviceList({
  rows,
  total,
  summary,
  brands,
  categories,
  branches,
  filters,
  canManage,
  showCost,
}: {
  rows: Row[]
  total: number
  summary: { mainType: MainType; isNewCut: boolean; units: number }[]
  brands: { id: number; name: string }[]
  categories: { id: number; name: string }[]
  branches: { id: number; code: string; name: string }[]
  filters: Record<string, unknown>
  canManage: boolean
  showCost: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [term, setTerm] = useState(String(filters.search ?? ''))
  const [, startTransition] = useTransition()

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    q.delete('page')
    startTransition(() => router.push(`/devices?${q.toString()}`))
  }

  /**
   * PRD FR-5.4: the five types are reported separately, and GLOBAL is split
   * into plain vs NEW CUT. That split is the whole point of the summary.
   */
  const counts = new Map<string, number>()
  for (const s of summary) {
    const key = s.mainType === 'GLOBAL' ? (s.isNewCut ? 'GLOBAL_NEW_CUT' : 'GLOBAL_PLAIN') : s.mainType
    counts.set(key, (counts.get(key) ?? 0) + s.units)
  }
  const tiles = [
    ...MAIN_TYPES.filter((t) => t !== 'GLOBAL').map((t) => ({
      key: t,
      label: t,
      count: counts.get(t) ?? 0,
      href: `/devices?mainType=${t}`,
    })),
    {
      key: 'GLOBAL_PLAIN',
      label: 'GLOBAL',
      count: counts.get('GLOBAL_PLAIN') ?? 0,
      href: '/devices?globalVariant=PLAIN',
    },
    {
      key: 'GLOBAL_NEW_CUT',
      label: 'GLOBAL · NEW CUT',
      count: counts.get('GLOBAL_NEW_CUT') ?? 0,
      href: '/devices?globalVariant=NEW_CUT',
    },
  ]

  const selectClass =
    'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Devices</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('en-IN')} matching. Phones by IMEI, laptops and other electronics by serial number.
          </p>
        </div>
        {canManage ? (
          // Deliberately secondary. Stock normally arrives through a purchase;
          // this is the manual path for opening stock and corrections.
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/devices/new">Add manually</Link>
          </Button>
        ) : null}
      </div>

      {/* In-stock counts. GLOBAL is deliberately shown as two tiles. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href}>
            <Card className="p-3 transition-colors hover:bg-accent">
              <p className="truncate text-xs text-muted-foreground">{t.label}</p>
              <p className="tabular text-xl font-semibold">{t.count}</p>
            </Card>
          </Link>
        ))}
      </div>

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
            className="pl-8"
            placeholder="IMEI, serial or product"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label="Search devices"
            />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>

        <select
          className={selectClass}
          aria-label="Main type"
          value={String(filters.mainType ?? '')}
          onChange={(e) => apply({ mainType: e.target.value, globalVariant: null })}
        >
          <option value="">All types</option>
          {MAIN_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          aria-label="Branch"
          value={String(filters.branchId ?? '')}
          onChange={(e) => apply({ branchId: e.target.value })}
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
          aria-label="Brand"
          value={String(filters.brandId ?? '')}
          onChange={(e) => apply({ brandId: e.target.value })}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          aria-label="Category"
          value={String(filters.categoryId ?? '')}
          onChange={(e) => apply({ categoryId: e.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </form>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No devices match these filters.
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden" data-testid="device-cards">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/devices/${r.id}`}
                      className="block truncate font-mono text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {r.primaryIdentifier ?? `#${r.id}`}
                    </Link>
                    <p className="truncate text-sm text-muted-foreground">
                      {r.brandName ? `${r.brandName} ` : ''}
                      {r.productName}
                    </p>
                  </div>
                  <DeviceStatusBadge status={r.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MainTypeBadge mainType={r.mainType} isNewCut={r.isNewCut} />
                  {r.branchCode ? (
                    <span className="text-xs text-muted-foreground">{r.branchCode}</span>
                  ) : null}
                  <span className="tabular ml-auto text-sm">
                    {formatMoney(r.sellingPricePaise)}
                  </span>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block" data-testid="device-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Branch</TableHead>
                  <TableHead>Status</TableHead>
                  {showCost ? <TableHead className="text-right">Cost</TableHead> : null}
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/devices/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.primaryIdentifier ?? `#${r.id}`}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{r.productName}</span>
                      {r.storage || r.colour || r.batteryHealthPercent != null ? (
                        <span className="block text-xs text-muted-foreground">
                          {[
                            r.storage,
                            r.colour,
                            r.batteryHealthPercent != null
                              ? `battery ${r.batteryHealthPercent}%`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <MainTypeBadge mainType={r.mainType} isNewCut={r.isNewCut} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{r.branchName ?? '—'}</TableCell>
                    <TableCell>
                      <DeviceStatusBadge status={r.status} />
                    </TableCell>
                    {showCost ? (
                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatMoney(r.purchasePricePaise)}
                      </TableCell>
                    ) : null}
                    <TableCell className="tabular text-right">
                      {formatMoney(r.sellingPricePaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
