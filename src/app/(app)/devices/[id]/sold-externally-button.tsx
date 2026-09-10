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

/**
 * PRD FR-38.3. For a device the other system bills: stock drops now, and the
 * daily import fills in the real invoice later.
 */
export function SoldExternallyButton({ deviceId }: { deviceId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function mark() {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/devices/${deviceId}/sold-externally`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not mark this device.')
      return
    }
    toast.success('Marked sold in the other system.')
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Sold in other system
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as sold elsewhere?</DialogTitle>
          <DialogDescription>
            Use this when the other billing system sold this handset. Stock drops immediately so it
            cannot also be sold here, and the daily import will fill in the real invoice, date and
            price.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <div className="space-y-1.5">
          <Label htmlFor="external-note">Note (optional)</Label>
          <Input
            id="external-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Their bill number, if known"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void mark()}>
            {busy ? 'Saving…' : 'Mark as sold'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
