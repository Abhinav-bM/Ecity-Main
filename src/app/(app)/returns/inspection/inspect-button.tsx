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
import { AppSelect } from '@/components/app-select'

const GRADES = [
  { value: 'AVAILABLE', label: 'Available — back on sale as normal' },
  { value: 'USED', label: 'Used — sellable, second-hand condition' },
  { value: 'DAMAGED', label: 'Damaged — not sellable' },
  { value: 'REPAIR_REQUIRED', label: 'Repair required — send for repair' },
]

/**
 * PRD FR-8.3. The gate that lets a returned handset back on sale.
 *
 * Deliberately not available to counter staff: deciding a returned phone is
 * fit to sell again is a judgement, and the whole point of the inspection
 * queue is that somebody makes it explicitly.
 */
export function InspectButton({
  deviceId,
  identifier,
  mainType,
}: {
  deviceId: number
  identifier: string | null
  mainType: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [grade, setGrade] = useState('AVAILABLE')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/devices/${deviceId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grade, notes }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not record the inspection.')
      return
    }
    toast.success(`${identifier ?? 'Device'} graded ${grade.replace('_', ' ').toLowerCase()}.`)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Inspect</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inspect {identifier ?? `device #${deviceId}`}</DialogTitle>
          <DialogDescription>
            This handset stays out of stock until it is graded. Grading records its
            <strong> condition</strong> — it does not change its type, which stays {mainType}.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="grade">Condition</Label>
            <AppSelect
              id="grade"
              label="Condition"
              value={grade}
              onValueChange={setGrade}
              options={GRADES}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inspect-notes">Notes</Label>
            <Input
              id="inspect-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cracked screen, box missing…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Record inspection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
