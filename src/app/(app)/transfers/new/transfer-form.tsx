'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AppSelect } from '@/components/app-select'
import { MainTypeBadge } from '@/components/main-type-badge'
import type { MainType } from '@/server/db/schema'

type Line = {
  key: string
  productId: number
  productName: string
  deviceId: number | null
  identifier: string | null
  quantity: number
  /** How many the sending branch actually holds, for accessories. */
  available: number
}

type Sendable = {
  devices: {
    id: number
    identifier: string | null
    productId: number
    productName: string
    mainType: MainType
    isNewCut: boolean
  }[]
  accessories: { productId: number; productName: string; quantity: number }[]
}

/**
 * Asking for stock to move (PRD FR-3.6).
 *
 * Only what the sending branch actually holds can be chosen — a request for
 * stock that is not there is a request that can never be dispatched.
 */
export function TransferForm({
  branches,
  defaultFromId,
}: {
  branches: { id: number; name: string }[]
  defaultFromId: number
}) {
  const router = useRouter()
  const [fromId, setFromId] = useState(String(defaultFromId))
  const [toId, setToId] = useState(
    String(branches.find((b) => b.id !== defaultFromId)?.id ?? branches[0]!.id),
  )
  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<Sendable>({ devices: [], accessories: [] })
  const [lines, setLines] = useState<Line[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reload whenever the sending branch or the search changes — what can be
  // sent depends entirely on where it is being sent from.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ branchId: fromId })
      if (search.trim()) q.set('search', search.trim())
      void fetch(`/api/transfers/sendable?${q.toString()}`)
        .then((r) => (r.ok ? r.json() : { devices: [], accessories: [] }))
        .then((data: Sendable) => {
          if (!cancelled) setStock(data)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fromId, search])

  function addDevice(d: Sendable['devices'][number]) {
    if (lines.some((l) => l.deviceId === d.id)) return
    setLines((s) => [
      ...s,
      {
        key: `d${d.id}`,
        productId: d.productId,
        productName: d.productName,
        deviceId: d.id,
        identifier: d.identifier,
        quantity: 1,
        available: 1,
      },
    ])
  }

  function addAccessory(a: Sendable['accessories'][number]) {
    if (lines.some((l) => l.deviceId === null && l.productId === a.productId)) return
    setLines((s) => [
      ...s,
      {
        key: `p${a.productId}`,
        productId: a.productId,
        productName: a.productName,
        deviceId: null,
        identifier: null,
        quantity: 1,
        available: a.quantity,
      },
    ])
  }

  async function submit() {
    setError(null)
    if (fromId === toId) return setError('Choose two different branches.')
    if (lines.length === 0) return setError('Add something to send.')

    setBusy(true)
    const res = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromBranchId: Number(fromId),
        toBranchId: Number(toId),
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          deviceId: l.deviceId,
          quantity: l.quantity,
        })),
      }),
    })
    setBusy(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not request the transfer.')
    }
    const saved = (await res.json()) as { id: number; transferNumber: string }
    toast.success(`${saved.transferNumber} requested.`)
    router.push(`/transfers/${saved.id}`)
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Request a transfer</h1>
        <p className="text-sm text-muted-foreground">
          Nothing leaves the shelf yet. Stock moves when someone approves and dispatches it.
        </p>
      </div>

      <FormError message={error} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Where it is going</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fromId">From</Label>
            <AppSelect
              id="fromId"
              label="From"
              value={fromId}
              onValueChange={(v) => {
                setFromId(v)
                // The old lines belong to the old branch's shelf.
                setLines([])
              }}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="toId">To</Label>
            <AppSelect
              id="toId"
              label="To"
              value={toId}
              onValueChange={setToId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What to send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="stock-search">Search this branch&rsquo;s stock</Label>
            <Input
              id="stock-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="IMEI or product name"
            />
          </div>

          {stock.devices.length > 0 ? (
            <div className="space-y-1.5" data-testid="sendable-devices">
              <p className="text-xs font-medium text-muted-foreground">Handsets</p>
              {stock.devices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addDevice(d)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{d.identifier}</span>
                    <span className="block text-muted-foreground">{d.productName}</span>
                  </span>
                  <MainTypeBadge mainType={d.mainType} isNewCut={d.isNewCut} />
                </button>
              ))}
            </div>
          ) : null}

          {stock.accessories.length > 0 ? (
            <div className="space-y-1.5" data-testid="sendable-accessories">
              <p className="text-xs font-medium text-muted-foreground">Accessories</p>
              {stock.accessories.map((a) => (
                <button
                  key={a.productId}
                  type="button"
                  onClick={() => addAccessory(a)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>{a.productName}</span>
                  <span className="tabular text-muted-foreground">{a.quantity} on hand</span>
                </button>
              ))}
            </div>
          ) : null}

          {stock.devices.length === 0 && stock.accessories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing at this branch matches. Only stock that is actually here can be sent.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">On this transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing added yet.</p>
          ) : (
            lines.map((l) => (
              <div
                key={l.key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                data-testid="transfer-line"
              >
                <div className="min-w-0">
                  <p className="font-medium">{l.productName}</p>
                  {l.identifier ? (
                    <p className="font-mono text-xs text-muted-foreground">{l.identifier}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{l.available} on hand</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {l.deviceId === null ? (
                    <Input
                      className="h-9 w-20"
                      inputMode="numeric"
                      aria-label={`Quantity for ${l.productName}`}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((s) =>
                          s.map((x) =>
                            x.key === l.key
                              ? {
                                  ...x,
                                  quantity: Math.max(
                                    1,
                                    Math.min(x.available, Number(e.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${l.productName}`}
                    onClick={() => setLines((s) => s.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <div className="space-y-1.5 pt-2">
            <Label htmlFor="transfer-notes">Notes</Label>
            <Textarea
              id="transfer-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/transfers')}>
          Cancel
        </Button>
        <Button disabled={busy || lines.length === 0} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Request transfer'}
        </Button>
      </div>
    </div>
  )
}
