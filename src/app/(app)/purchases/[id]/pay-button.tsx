'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
import { formatMoney } from '@/lib/money'
import { paiseToRupees, parseRupees, rupeesToPaise } from '@/lib/validation'
import { apiFetch } from '@/lib/api'

/**
 * Paying a bill from the bill.
 *
 * Until now the only way to settle a purchase after the fact was the supplier
 * dues screen, which pays a *supplier* and allocates oldest-first. So somebody
 * looking at the one bill they meant to pay had to leave it, find the supplier,
 * and trust that the oldest open purchase was the one in front of them. It
 * usually was. When it was not, the wrong bill was marked paid.
 *
 * This allocates explicitly to this purchase, so what you were looking at is
 * what gets settled.
 */
export function PayPurchaseButton({
  purchaseId,
  supplierId,
  supplierName,
  branchId,
  owingPaise,
  paymentMethods,
}: {
  purchaseId: number
  supplierId: number
  supplierName: string
  branchId: number
  owingPaise: bigint
  paymentMethods: { id: number; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  /** Prefilled with the whole outstanding amount — the common case is settling it. */
  const [amount, setAmount] = useState(String(paiseToRupees(owingPaise)))
  const [methodId, setMethodId] = useState(String(paymentMethods[0]?.id ?? ''))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /*
   * Follow the outstanding amount as the page learns it.
   *
   * Resetting only when the dialog opens is not enough: a part payment closes
   * it and calls `router.refresh()`, and the smaller amount arrives a moment
   * later. Reopening in that gap offered to pay the part again.
   */
  useEffect(() => {
    setAmount(String(paiseToRupees(owingPaise)))
  }, [owingPaise])

  // Integer paise throughout (docs/03 §4.1) - never float rupees.
  const enteredPaise = amount.trim() ? rupeesToPaise(parseRupees(amount)) : 0n
  const valid = enteredPaise > 0n
  const remaining = enteredPaise >= owingPaise ? 0n : owingPaise - enteredPaise

  async function pay() {
    setError(null)
    setBusy(true)
    const res = await apiFetch('/api/supplier-payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplierId,
        branchId,
        paymentMethodId: methodId,
        amount,
        reference,
        // Explicit: this bill, not whichever is oldest.
        allocations: [{ purchaseId, amount }],
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.success('Payment recorded.')
    setOpen(false)
    router.refresh()
  }

  if (paymentMethods.length === 0) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href="/settings/business">Add a payment method to pay</Link>
      </Button>
    )
  }

  return (
    <Dialog
      open={open}
      /*
        Re-prefilled every time it opens, not just on first mount. After a part
        payment the page refreshes with a smaller outstanding amount, and the
        box was still showing what was typed last time - so clearing the rest of
        a bill offered to pay the part again.
      */
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setAmount(String(paiseToRupees(owingPaise)))
          setReference('')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay this bill</DialogTitle>
          <DialogDescription>
            {formatMoney(owingPaise)} outstanding to {supplierName}. This settles this purchase
            specifically, not the oldest one on the account.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pp-amount">Amount (₹)</Label>
            <Input
              id="pp-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Prefilled with the full outstanding amount. Enter less for a part payment.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-method">Payment method</Label>
            <AppSelect
              id="pp-method"
              label="Payment method"
              value={methodId}
              onValueChange={setMethodId}
              options={paymentMethods.map((m) => ({ value: String(m.id), label: m.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-reference">Reference</Label>
            <Input
              id="pp-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UPI ref, cheque number…"
            />
          </div>

          {/* What is left after this payment, worked out as they type. */}
          {valid ? (
            <dl
              className="flex items-baseline justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
              data-testid="pay-remaining"
            >
              <dt className="text-muted-foreground">
                {remaining > 0n ? 'Still to pay after this' : 'Nothing left to pay'}
              </dt>
              <dd className="tabular font-medium">{formatMoney(remaining)}</dd>
            </dl>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !valid || !methodId} onClick={() => void pay()}>
            {busy ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
