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
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Correcting a purchase (carried into M7 from M5).
 *
 * Metadata only. Lines, quantities and costs are not here on purpose: a
 * confirmed purchase has already moved stock, created devices and posted to
 * the supplier ledger, so editing a cost would leave the ledger disagreeing
 * with the stock. Reversal is the honest tool for that, and it already refuses
 * once a unit has sold.
 */
export function EditPurchaseMeta({
  purchaseId,
  supplierInvoiceNumber,
  purchaseDate,
  notes,
}: {
  purchaseId: number
  supplierInvoiceNumber: string | null
  purchaseDate: string
  notes: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [invoice, setInvoice] = useState(supplierInvoiceNumber ?? '')
  const [date, setDate] = useState(purchaseDate)
  const [note, setNote] = useState(notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/purchases/${purchaseId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplierInvoiceNumber: invoice.trim() || null,
        purchaseDate: date,
        notes: note.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return setError(data.error ?? 'Could not save the correction.')
    }
    setOpen(false)
    toast.success('Purchase corrected.')
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Correct details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct this purchase</DialogTitle>
            <DialogDescription>
              The supplier&rsquo;s bill number, the date and the notes. Lines and costs are not
              editable — stock has already moved and the supplier ledger has already been posted,
              so those are corrected by reversing the purchase.
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-invoice">Supplier bill number</Label>
              <Input
                id="pm-invoice"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-date">Purchase date</Label>
              <Input
                id="pm-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-notes">Notes</Label>
              <Textarea
                id="pm-notes"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Save correction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
