'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
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

export function ReverseButton({ purchaseId }: { purchaseId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reverse() {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/purchases/${purchaseId}/reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      // The message names the units that block it, which is the useful part.
      setError(data.error ?? 'Could not reverse this purchase.')
      return
    }
    toast.success('Purchase reversed.')
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reverse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this purchase?</DialogTitle>
          <DialogDescription>
            Stock goes back out and the supplier debt is cancelled. Units that have already been
            sold or moved will block it — nothing is deleted, and the reason is recorded.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="space-y-1.5">
          <Label htmlFor="reverse-reason">Reason</Label>
          <Input
            id="reverse-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Wrong delivery, entered twice…"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void reverse()}
          >
            {busy ? 'Reversing…' : 'Reverse purchase'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
