'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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

/**
 * An expense is voided, never deleted. The money is posted back to the drawer
 * or account it came out of, and both entries stay on the record.
 */
export function VoidExpenseButton({ id, amount }: { id: number; amount: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason.trim()) return
    setBusy(true)
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not void it.')
      return
    }
    setOpen(false)
    toast.success('Expense voided and the money put back.')
    router.refresh()
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Void
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this {amount} expense?</DialogTitle>
            <DialogDescription>
              The entry stays on the record and the money goes back where it came from. Say why, so
              the day still explains itself later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Entered twice"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void submit()}>
              {busy ? 'Voiding…' : 'Void expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
