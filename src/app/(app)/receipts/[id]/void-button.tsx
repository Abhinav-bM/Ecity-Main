'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Voided, never deleted — a bounced cheque is history, not a mistake to hide. */
export function VoidReceiptButton({
  id,
  receiptNumber,
}: {
  id: number
  receiptNumber: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/customer-payments/${id}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not void the receipt.')
      return
    }
    toast.success('Receipt voided. The balance is owing again.')
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Void
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {receiptNumber}?</DialogTitle>
          <DialogDescription>
            The receipt stays on record, marked voided, and the amount goes back onto the
            customer&apos;s balance. Use this for a bounced cheque or a payment entered twice.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Input
            id="void-reason"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Cheque bounced"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {busy ? 'Voiding…' : 'Void receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
