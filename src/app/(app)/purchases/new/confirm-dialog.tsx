'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatMoney } from '@/lib/money'

/**
 * One last "are you sure" before a purchase is written.
 *
 * Confirming is the step that moves everything - stock rises, every handset is
 * registered, and the shop owes the supplier - and it is undone only by a
 * reversal, and only while every unit it brought in is still untouched. The
 * total and the supplier are named because they are the two things somebody
 * about to click past this would want to have seen.
 */
export function ConfirmPurchaseDialog({
  open,
  onOpenChange,
  onConfirm,
  saving,
  supplierName,
  totalPaise,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  saving: boolean
  supplierName: string
  totalPaise: bigint
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save this purchase?</DialogTitle>
          <DialogDescription>
            {formatMoney(totalPaise)} to {supplierName}. This raises stock and posts what you owe
            them — undoing it means reversing the purchase.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? 'Saving…' : 'Yes, save it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
