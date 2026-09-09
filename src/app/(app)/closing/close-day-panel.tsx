'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/money'
import { rupeesToPaise } from '@/lib/validation'

type Method = { id: number; name: string; expectedPaise: string }

/**
 * Counting the till and signing the day off (PRD FR-13.2 – FR-13.4).
 *
 * The difference is shown live as the number is typed, so the person counting
 * sees a shortage while the cash is still in front of them rather than after
 * the fact.
 */
export function CloseDayPanel({
  mode,
  branchId,
  businessDate,
  expectedPaise,
  methods,
  closingId,
}: {
  mode: 'close' | 'reopen'
  branchId: number
  businessDate: string
  expectedPaise: string
  methods: Method[]
  closingId?: number
}) {
  if (mode === 'reopen') {
    return <ReopenButton closingId={closingId!} businessDate={businessDate} />
  }
  return (
    <CloseForm
      branchId={branchId}
      businessDate={businessDate}
      expectedPaise={expectedPaise}
      methods={methods}
    />
  )
}

function CloseForm({
  branchId,
  businessDate,
  expectedPaise,
  methods,
}: {
  branchId: number
  businessDate: string
  expectedPaise: string
  methods: Method[]
}) {
  const router = useRouter()
  const [counted, setCounted] = useState('')
  const [byMethod, setByMethod] = useState<Record<number, string>>({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const expected = BigInt(expectedPaise)
  const difference = useMemo(() => {
    const value = Number(counted)
    if (counted === '' || !Number.isFinite(value)) return null
    return rupeesToPaise(value) - expected
  }, [counted, expected])

  async function submit() {
    setError(null)
    const value = Number(counted)
    if (counted === '' || !Number.isFinite(value) || value < 0) {
      return setError('Enter what you actually counted.')
    }

    setBusy(true)
    const res = await fetch('/api/closings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branchId,
        businessDate,
        countedCash: value,
        countedByMethod: Object.fromEntries(
          Object.entries(byMethod)
            .filter(([, v]) => v !== '')
            .map(([k, v]) => [k, Number(v)]),
        ),
        notes,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not close the day.')
    }
    toast.success('Day closed.')
    router.refresh()
  }

  return (
    <Card data-testid="close-day">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Count the till and close</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="counted">Counted cash (₹)</Label>
            <Input
              id="counted"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Difference</Label>
            <div
              className="flex h-9 items-center rounded-md border px-3 text-sm"
              data-testid="closing-difference"
            >
              {difference === null ? (
                <span className="text-muted-foreground">
                  Expected {formatMoney(expected)}
                </span>
              ) : difference === 0n ? (
                <span className="font-medium text-success">Matches exactly</span>
              ) : difference < 0n ? (
                <span className="font-medium text-destructive">
                  {formatMoney(-difference)} short
                </span>
              ) : (
                <span className="font-medium text-warning-foreground">
                  {formatMoney(difference)} over
                </span>
              )}
            </div>
          </div>
        </div>

        {methods.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              What each non-cash method should have taken. Enter the settlement figure if
              you have it.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {methods.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <Label htmlFor={`m-${m.id}`}>
                    {m.name}{' '}
                    <span className="text-muted-foreground">
                      (expected {formatMoney(BigInt(m.expectedPaise))})
                    </span>
                  </Label>
                  <Input
                    id={`m-${m.id}`}
                    inputMode="decimal"
                    value={byMethod[m.id] ?? ''}
                    onChange={(e) => setByMethod((s) => ({ ...s, [m.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="closing-notes">Notes</Label>
          <Textarea
            id="closing-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything that explains a difference"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Once closed, these figures are never rewritten. A later fix is a new entry in the day, and
          both are shown.
        </p>

        <div className="flex justify-end">
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Closing…' : 'Close the day'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Reopening, for the mistake everyone actually makes: closing at six and then
 * taking a sale at seven. Refused once a later day has been closed.
 */
function ReopenButton({ closingId, businessDate }: { closingId: number; businessDate: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    if (!reason.trim()) return setError('Say why the day is being reopened.')
    setBusy(true)
    const res = await fetch(`/api/closings/${closingId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not reopen the day.')
    }
    setOpen(false)
    toast.success('Day reopened.')
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reopen this day
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen {businessDate}?</DialogTitle>
            <DialogDescription>
              The closing is kept, marked as voided — that the day was closed and reopened stays on
              the record. This is refused once a later day has been closed.
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">Reason</Label>
            <Input
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Closed before the last sale"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !reason.trim()} onClick={() => void submit()}>
              {busy ? 'Reopening…' : 'Reopen day'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
