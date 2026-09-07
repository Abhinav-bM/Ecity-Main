'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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

type Item = {
  id: number
  label: string
  quantity: number
  isDevice: boolean
  /** The IMEI, for scanning it in at the destination. */
  identifier: string | null
}
type Status = 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'

/**
 * Moving a transfer along (PRD FR-3.6).
 *
 * Only the step the transfer is actually at is offered. The server enforces
 * the same rule; this just stops anyone being asked to make a choice that
 * would be refused.
 */
export function TransferActions({
  transferId,
  status,
  items,
  canApprove,
  canReceive,
  canCancel,
  atWrongEnd,
  otherBranchName,
}: {
  transferId: number
  status: Status
  items: Item[]
  canApprove: boolean
  canReceive: boolean
  canCancel: boolean
  /** The next step belongs to the branch at the other end of the journey. */
  atWrongEnd: boolean
  otherBranchName: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')

  async function act(body: Record<string, unknown>, done: string) {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/transfers/${transferId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'That did not work.')
      return false
    }
    toast.success(done)
    router.refresh()
    return true
  }

  if (status === 'RECEIVED' || status === 'CANCELLED') return null

  return (
    <Card data-testid="transfer-actions">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {status === 'REQUESTED'
            ? 'Approve it'
            : status === 'APPROVED'
              ? 'Send it'
              : 'Receive it'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}

        {status === 'IN_TRANSIT' && canReceive ? (
          <ReceivePanel items={items} busy={busy} onReceive={act} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status === 'REQUESTED' && canApprove ? (
            <Button disabled={busy} onClick={() => void act({ action: 'approve' }, 'Approved.')}>
              Approve
            </Button>
          ) : null}
          {status === 'APPROVED' && canApprove ? (
            <Button
              disabled={busy}
              onClick={() => void act({ action: 'dispatch' }, 'Dispatched — now in transit.')}
            >
              Dispatch
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
              Cancel transfer
            </Button>
          ) : null}
        </div>

        {atWrongEnd ? (
          <p className="text-xs text-muted-foreground" data-testid="wrong-end">
            {status === 'IN_TRANSIT'
              ? `Waiting for ${otherBranchName} to receive it. Signing for a delivery is the receiving branch's job — the branch that packed the box cannot attest it arrived.`
              : `${otherBranchName} sends this. Approving stock out of a branch is that branch's decision.`}
          </p>
        ) : status === 'REQUESTED' && !canApprove ? (
          <p className="text-xs text-muted-foreground">
            Waiting for a manager to approve. Sending stock out of a branch is their decision.
          </p>
        ) : null}
        {status === 'APPROVED' ? (
          <p className="text-xs text-muted-foreground">
            Dispatching takes this stock off the sending branch. It will not be sellable anywhere
            until it is received.
          </p>
        ) : null}
      </CardContent>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this transfer?</DialogTitle>
            <DialogDescription>
              {status === 'IN_TRANSIT'
                ? 'The goods go back to the sending branch — they never reached the destination, so that is where they are.'
                : 'Nothing has moved yet, so nothing is put back.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Van broke down"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                const ok = await act({ action: 'cancel', reason }, 'Transfer cancelled.')
                if (ok) setCancelOpen(false)
              }}
            >
              Cancel transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/**
 * The receiving screen (FR-3.7).
 *
 * Tick what is actually in the box. Anything unticked did not arrive, and the
 * screen says what that means before it is confirmed — a handset that left one
 * branch and reached no other has to be accounted for, not quietly forgotten.
 */
function ReceivePanel({
  items,
  busy,
  onReceive,
}: {
  items: Item[]
  busy: boolean
  onReceive: (body: Record<string, unknown>, done: string) => Promise<boolean>
}) {
  /*
   * Start with nothing received when there is anything to scan.
   *
   * A box you scan into is safer than one you untick: if the scanner misses a
   * handset, the transfer is short and someone looks for it. Starting ticked
   * would mean a missed scan silently passes as received. Accessories have no
   * barcode to scan here, so they keep their sent quantity.
   */
  const scannable = items.some((i) => i.isDevice && i.identifier)
  const [received, setReceived] = useState<Record<number, number>>(
    Object.fromEntries(
      items.map((i) => [i.id, i.isDevice && scannable ? 0 : i.quantity]),
    ),
  )
  const [notes, setNotes] = useState('')
  const [scan, setScan] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [unexpected, setUnexpected] = useState<string[]>([])

  const short = items.some((i) => (received[i.id] ?? 0) < i.quantity)

  /** One scan: tick the matching line, or flag it as not on this transfer. */
  function handleScan(raw: string) {
    const value = raw.trim()
    if (!value) return
    setScan('')
    setScanError(null)

    const match = items.find((i) => i.identifier === value)
    if (match) {
      setReceived((s) => ({ ...s, [match.id]: 1 }))
      return
    }
    if (unexpected.includes(value)) return
    /*
     * Something in the box that is not on the paperwork. Recorded, not acted
     * on - moving it here would be inventing a transfer nobody authorised.
     */
    setUnexpected((s) => [...s, value])
    setScanError(`${value} is not on this transfer.`)
  }

  return (
    <div className="space-y-3">
      {scannable ? (
        <div className="space-y-1.5">
          <Label htmlFor="receive-scan">Scan each IMEI as you unpack</Label>
          <Input
            id="receive-scan"
            value={scan}
            autoFocus
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              // A barcode scanner types the code and presses Enter.
              if (e.key === 'Enter') {
                e.preventDefault()
                handleScan(scan)
              }
            }}
            placeholder="Scan or type an IMEI, then Enter"
          />
          {scanError ? <p className="text-xs text-destructive">{scanError}</p> : null}
          <p className="text-xs text-muted-foreground">
            Nothing is ticked until it is scanned, so a handset the scanner misses shows as short
            rather than passing quietly. You can tick one by hand if it will not scan.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Check off what is actually in the box. Everything is ticked to start with, so you only
          touch what is wrong.
        </p>
      )}

      {unexpected.length > 0 ? (
        <div className="space-y-1.5" data-testid="unexpected-list">
          <Alert variant="destructive">
            {unexpected.length} item(s) arrived that are not on this transfer. They will be
            recorded on it — someone needs to find out where they came from.
          </Alert>
          <ul className="space-y-1">
            {unexpected.map((u) => (
              <li
                key={u}
                className="flex items-center justify-between rounded-md border px-3 py-1.5 font-mono text-xs"
              >
                {u}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${u}`}
                  onClick={() => setUnexpected((s) => s.filter((x) => x !== u))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        {items.map((i) => (
          <div
            key={i.id}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            data-testid="receive-line"
          >
            <div className="flex min-w-0 items-center gap-2">
              {i.isDevice ? (
                <Checkbox
                  id={`recv-${i.id}`}
                  checked={(received[i.id] ?? 0) > 0}
                  onCheckedChange={(v) =>
                    setReceived((s) => ({ ...s, [i.id]: v === true ? 1 : 0 }))
                  }
                />
              ) : null}
              <Label htmlFor={`recv-${i.id}`} className="min-w-0 font-normal">
                <span className="block truncate">{i.label}</span>
                {!i.isDevice ? (
                  <span className="text-xs text-muted-foreground">{i.quantity} sent</span>
                ) : null}
              </Label>
            </div>
            {!i.isDevice ? (
              <Input
                className="h-9 w-20"
                inputMode="numeric"
                aria-label={`Received quantity for ${i.label}`}
                value={received[i.id] ?? 0}
                onChange={(e) =>
                  setReceived((s) => ({
                    ...s,
                    [i.id]: Math.max(0, Math.min(i.quantity, Number(e.target.value) || 0)),
                  }))
                }
              />
            ) : null}
          </div>
        ))}
      </div>

      {short ? (
        <div className="space-y-1.5" data-testid="short-warning">
          <Alert variant="destructive">
            Something did not arrive. Any missing handset will be marked lost — it left one branch
            and reached no other, so it has to be accounted for.
          </Alert>
          <Label htmlFor="discrepancy">What happened</Label>
          <Input
            id="discrepancy"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Box was opened in transit"
          />
        </div>
      ) : null}

      <Button
        disabled={busy}
        data-testid="receive-button"
        onClick={() =>
          void onReceive(
            {
              action: 'receive',
              lines: items.map((i) => ({
                transferItemId: i.id,
                receivedQuantity: received[i.id] ?? 0,
              })),
              discrepancyNotes: notes,
              unexpectedIdentifiers: unexpected,
            },
            short || unexpected.length
              ? 'Received, with a discrepancy recorded.'
              : 'Received in full.',
          )
        }
      >
        {short || unexpected.length ? 'Receive with a discrepancy' : 'Receive in full'}
      </Button>
    </div>
  )
}
