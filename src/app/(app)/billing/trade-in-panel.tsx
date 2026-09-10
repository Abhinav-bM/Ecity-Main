'use client'

import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
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
import { AppSelect } from '@/components/app-select'
import { ProductPicker, type PickedProduct } from '@/components/product-picker'
import { MAIN_TYPES, parseRupees, rupeesToPaise } from '@/lib/validation'
import { formatMoney } from '@/lib/money'
import type { useCart } from '@/stores/cart'
import { apiFetch } from '@/lib/api'

type TradeIn = ReturnType<typeof useCart.getState>['tradeIn']

/**
 * PRD FR-9.1 – FR-9.3. Taking an old phone in against this bill.
 *
 * The handset is registered the moment it is accepted, so it exists as stock
 * with its own history straight away. Its value then comes off what the
 * customer has to pay, which the totals panel shows as the difference.
 */
export function TradeInPanel({
  branchId,
  customerId,
  tradeIn,
  onChange,
}: {
  branchId: number
  customerId: number | null
  tradeIn: TradeIn
  onChange: (tradeIn: TradeIn) => void
}) {
  const [open, setOpen] = useState(false)

  if (tradeIn) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-sm">Trade-in</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="font-mono text-xs">{tradeIn.identifier}</p>
          <p className="tabular font-medium">{formatMoney(BigInt(tradeIn.valuePaise))} allowed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Already in stock at this branch. Removing it here does not take it back out.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm">Trade-in</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <ArrowLeftRight className="size-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Taking an old phone against this sale? Its value comes off the total.
        </p>
      </CardContent>

      <TradeInDialog
        open={open}
        onOpenChange={setOpen}
        branchId={branchId}
        customerId={customerId}
        onAccepted={onChange}
      />
    </Card>
  )
}

function TradeInDialog({
  open,
  onOpenChange,
  branchId,
  customerId,
  onAccepted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchId: number
  customerId: number | null
  onAccepted: (tradeIn: TradeIn) => void
}) {
  const [product, setProduct] = useState<PickedProduct | null>(null)
  const [identifier, setIdentifier] = useState('')
  const [mainType, setMainType] = useState('USED')
  const [storage, setStorage] = useState('')
  const [colour, setColour] = useState('')
  const [battery, setBattery] = useState('')
  const [estimated, setEstimated] = useState('')
  const [agreed, setAgreed] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function accept() {
    setError(null)
    if (!product) {
      setError('Choose which product the old handset is.')
      return
    }
    if (!identifier.trim()) {
      setError('Enter the IMEI or serial number.')
      return
    }

    setBusy(true)
    const res = await apiFetch('/api/trade-ins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        productId: product.id,
        identifiers: [identifier.trim()],
        branchId,
        mainType,
        storage,
        colour,
        batteryHealthPercent: battery ? Number(battery) : undefined,
        conditionNotes: notes,
        estimatedValue: estimated ? parseRupees(estimated) : undefined,
        agreedValue: parseRupees(agreed),
        customerId,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      setError(res.error)
      return
    }
    const { id, deviceId } = (res.data) as { id: number; deviceId: number }
    onAccepted({
      id,
      deviceId,
      identifier: identifier.trim(),
      valuePaise: rupeesToPaise(parseRupees(agreed)).toString(),
    })
    toast.success('Trade-in accepted and added to stock.')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Take a phone in trade</DialogTitle>
          <DialogDescription>
            The handset enters stock at this branch straight away, with its own history. Its
            agreed value comes off what the customer pays.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="trade-product">Which phone is it?</Label>
            <ProductPicker
              id="trade-product"
              label="Trade-in product"
              serialisedOnly
              value={product}
              onSelect={setProduct}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trade-imei">IMEI / serial</Label>
            <Input
              id="trade-imei"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="trade-type">Type</Label>
              <AppSelect
                id="trade-type"
                label="Trade-in type"
                value={mainType}
                onValueChange={setMainType}
                options={MAIN_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-battery">Battery health (%)</Label>
              <Input
                id="trade-battery"
                inputMode="numeric"
                value={battery}
                onChange={(e) => setBattery(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-storage">Storage</Label>
              <Input
                id="trade-storage"
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-colour">Colour</Label>
              <Input id="trade-colour" value={colour} onChange={(e) => setColour(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-estimated">Estimated value (₹)</Label>
              <Input
                id="trade-estimated"
                inputMode="decimal"
                value={estimated}
                onChange={(e) => setEstimated(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-agreed">Agreed value (₹)</Label>
              <Input
                id="trade-agreed"
                inputMode="decimal"
                value={agreed}
                onChange={(e) => setAgreed(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trade-notes">Condition notes</Label>
            <Input id="trade-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void accept()}>
            {busy ? 'Saving…' : 'Accept trade-in'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
