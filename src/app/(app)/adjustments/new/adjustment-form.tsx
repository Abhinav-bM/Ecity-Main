'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AppSelect } from '@/components/app-select'

const REASONS = [
  { value: 'MISCOUNT', label: 'Miscount — the shelf and the system disagree' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOSS', label: 'Loss or theft' },
  { value: 'DATA_ENTRY_ERROR', label: 'Data-entry error' },
]

type Accessory = { productId: number; productName: string; quantity: number }
type Device = { id: number; identifier: string | null; productId: number; productName: string }

/**
 * Correcting stock (PRD FR-28.1 – FR-28.3).
 *
 * Two different jobs behind one screen: counting accessories, and writing off
 * one handset. They are genuinely different — a handset has an IMEI and a
 * status, an accessory has a number — so the form asks which first rather than
 * pretending they are the same thing.
 */
export function AdjustmentForm({
  branches,
  defaultBranchId,
}: {
  branches: { id: number; name: string }[]
  defaultBranchId: number | null
}) {
  const router = useRouter()
  const [kind, setKind] = useState<'accessory' | 'device'>('accessory')
  const [branchId, setBranchId] = useState(String(defaultBranchId ?? ''))
  const [search, setSearch] = useState('')
  const [accessories, setAccessories] = useState<Accessory[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [picked, setPicked] = useState<{ productId: number; deviceId: number | null; label: string; onHand: number } | null>(null)
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('MISCOUNT')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ branchId })
      if (search.trim()) q.set('search', search.trim())
      const url =
        kind === 'accessory'
          ? `/api/adjustments/adjustable?${q.toString()}`
          : `/api/transfers/sendable?${q.toString()}`
      void fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          if (kind === 'accessory') setAccessories(data as Accessory[])
          else setDevices((data as { devices: Device[] }).devices)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [branchId, search, kind])

  // A handset is damaged or lost; a count is a count. Keep the reason legal.
  useEffect(() => {
    if (kind === 'device' && !['DAMAGE', 'LOSS'].includes(reason)) setReason('DAMAGE')
    if (kind === 'accessory' && !['MISCOUNT', 'DAMAGE', 'LOSS', 'DATA_ENTRY_ERROR'].includes(reason))
      setReason('MISCOUNT')
  }, [kind, reason])

  async function submit() {
    setError(null)
    if (!picked) return setError('Choose what is being adjusted.')

    let quantityDelta: number | undefined
    if (kind === 'accessory') {
      const value = Number(counted)
      if (counted === '' || !Number.isFinite(value) || value < 0) {
        return setError('Enter what you actually counted.')
      }
      quantityDelta = value - picked.onHand
      if (quantityDelta === 0) {
        return setError('That is what the system already says — nothing to correct.')
      }
    }

    setBusy(true)
    const res = await fetch('/api/adjustments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branchId: Number(branchId),
        productId: picked.productId,
        deviceId: picked.deviceId,
        reason,
        quantityDelta,
        notes,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not record the adjustment.')
    }
    toast.success('Stock adjusted.')
    router.push('/adjustments')
    router.refresh()
  }

  const delta = picked && counted !== '' ? Number(counted) - picked.onHand : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Adjust stock</h1>
        <p className="text-sm text-muted-foreground">
          This is recorded with your name and a reason, and cannot be edited afterwards. A wrong
          adjustment is corrected by a second one, so both stay visible.
        </p>
      </div>

      <FormError message={error} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">What are you correcting?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(['accessory', 'device'] as const).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setKind(k)
                  setPicked(null)
                  setCounted('')
                }}
              >
                {k === 'accessory' ? 'An accessory count' : 'One handset'}
              </Button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-branch">Branch</Label>
            <AppSelect
              id="adj-branch"
              label="Branch"
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v)
                setPicked(null)
              }}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-search">Find it</Label>
            <Input
              id="adj-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={kind === 'device' ? 'IMEI or model' : 'Product name'}
            />
          </div>

          {picked ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>
                {picked.label}
                {picked.deviceId === null ? (
                  <span className="block text-xs text-muted-foreground">
                    System says {picked.onHand}
                  </span>
                ) : null}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="adjustable-list">
              {(kind === 'accessory' ? accessories : devices).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing at this branch matches.</p>
              ) : kind === 'accessory' ? (
                accessories.map((a) => (
                  <button
                    key={a.productId}
                    type="button"
                    onClick={() =>
                      setPicked({
                        productId: a.productId,
                        deviceId: null,
                        label: a.productName,
                        onHand: a.quantity,
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>{a.productName}</span>
                    <span className="tabular text-muted-foreground">{a.quantity} on hand</span>
                  </button>
                ))
              ) : (
                devices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      setPicked({
                        productId: d.productId,
                        deviceId: d.id,
                        label: d.identifier ?? d.productName,
                        onHand: 1,
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-mono text-xs">{d.identifier}</span>
                    <span className="text-muted-foreground">{d.productName}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {picked ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">The correction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {kind === 'accessory' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="counted">Actually counted</Label>
                  <Input
                    id="counted"
                    inputMode="numeric"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Change</Label>
                  <div
                    className="flex h-9 items-center rounded-md border px-3 text-sm"
                    data-testid="adjustment-delta"
                  >
                    {delta === null || Number.isNaN(delta) ? (
                      <span className="text-muted-foreground">—</span>
                    ) : delta === 0 ? (
                      <span className="text-muted-foreground">No change</span>
                    ) : (
                      <span
                        className={delta < 0 ? 'font-medium text-destructive' : 'font-medium text-success'}
                      >
                        {delta > 0 ? '+' : ''}
                        {delta}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This takes the handset out of sellable stock. Its history keeps the record.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">Reason</Label>
              <AppSelect
                id="adj-reason"
                label="Reason"
                value={reason}
                onValueChange={setReason}
                options={
                  kind === 'device'
                    ? REASONS.filter((r) => ['DAMAGE', 'LOSS'].includes(r.value))
                    : REASONS
                }
              />
              {kind === 'device' ? (
                <p className="text-xs text-muted-foreground">
                  A miscount or a typo on a handset is a correction to the device record, not a
                  stock adjustment — use Edit on the device.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-notes">Notes</Label>
              <Textarea
                id="adj-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/adjustments')}>
          Cancel
        </Button>
        <Button disabled={busy || !picked} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Record adjustment'}
        </Button>
      </div>
    </div>
  )
}
