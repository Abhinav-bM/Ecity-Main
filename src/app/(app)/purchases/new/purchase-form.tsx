'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { MAIN_TYPES, rupeesToPaise } from '@/lib/validation'
import { formatMoney } from '@/lib/money'
import { shopDateString } from '@/lib/date'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'
import { ProductPicker, type PickedProduct } from '@/components/product-picker'
import { PartyPicker, type PickedParty } from '@/components/party-picker'
import { AppSelect } from '@/components/app-select'

type Line = {
  key: string
  product: PickedProduct | null
  quantity: string
  unitCost: string
  discount: string
  mainType: (typeof MAIN_TYPES)[number]
  isNewCut: boolean
  /** One per unit. Length must equal quantity for a serialised line. */
  identifiers: string[]
}

let counter = 0
const newLine = (): Line => ({
  key: `l${counter++}`,
  product: null,
  quantity: '1',
  unitCost: '',
  discount: '0',
  mainType: 'NEW',
  isNewCut: false,
  identifiers: [''],
})

export function PurchaseForm({
  branches,
  defaultBranchId,
}: {
  branches: { id: number; code: string; name: string }[]
  defaultBranchId: number | null
}) {
  const router = useRouter()
  const [supplier, setSupplier] = useState<PickedParty | null>(null)
  const [branchId, setBranchId] = useState(String(defaultBranchId ?? branches[0]?.id ?? ''))
  const [purchaseDate, setPurchaseDate] = useState(shopDateString())
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function update(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }

        // The identifier grid always has exactly one slot per unit, so the
        // count can never silently disagree with the quantity.
        if (next.product?.isSerialised) {
          const want = Math.max(1, Math.min(999, Number(next.quantity) || 1))
          const have = next.identifiers.length
          if (want > have) {
            next.identifiers = [...next.identifiers, ...Array(want - have).fill('')]
          } else if (want < have) {
            next.identifiers = next.identifiers.slice(0, want)
          }
        }
        if (next.mainType !== 'GLOBAL') next.isNewCut = false
        return next
      }),
    )
  }

  /**
   * Totals are summed in integer paise, exactly as the server will compute
   * them. Adding rupees as floats and rounding at the end would show the
   * shopkeeper a preview that disagrees with the saved figure by a paisa.
   */
  const totals = lines.reduce(
    (acc, l) => {
      const qty = BigInt(Math.trunc(Number(l.quantity) || 0))
      const cost = rupeesToPaise(Number(l.unitCost) || 0)
      const disc = rupeesToPaise(Number(l.discount) || 0)
      return { subtotal: acc.subtotal + cost * qty, discount: acc.discount + disc }
    },
    { subtotal: 0n, discount: 0n },
  )
  const total = totals.subtotal - totals.discount

  async function submit() {
    setFormError(null)

    // Catch the common mistake here rather than after a round trip.
    for (const l of lines) {
      const product = l.product
      if (!product) {
        setFormError('Every line needs a product.')
        return
      }
      if (product.isSerialised) {
        const filled = l.identifiers.filter((v) => v.trim()).length
        const qty = Number(l.quantity) || 0
        if (filled !== qty) {
          const what = product.identifierType === 'SERIAL' ? 'serial number' : 'IMEI'
          setFormError(
            `${product.name}: ${qty} unit${qty === 1 ? '' : 's'} but ${filled} ${what}${filled === 1 ? '' : 's'} entered. Each unit needs its own.`,
          )
          return
        }
      }
    }

    setSaving(true)
    const res = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplierId: supplier?.id,
        branchId,
        purchaseDate,
        supplierInvoiceNumber,
        notes,
        lines: lines.map((l) => {
          const product = l.product!
          return {
            productId: product.id,
            quantity: l.quantity,
            unitCost: l.unitCost || 0,
            discount: l.discount || 0,
            identifiers: product.isSerialised ? l.identifiers.filter((v) => v.trim()) : [],
            ...(product.isSerialised ? { mainType: l.mainType, isNewCut: l.isNewCut } : {}),
          }
        }),
      }),
    })
    setSaving(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not save the purchase.')
      return
    }
    const created = (await res.json()) as { purchaseNumber: string; id: number }
    toast.success(`Purchase ${created.purchaseNumber} recorded.`)
    router.push(`/purchases/${created.id}`)
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Record a purchase</h1>
        <p className="text-sm text-muted-foreground">
          Confirming raises stock, registers every unit and posts what you owe the supplier — in
          one step.
        </p>
      </div>

      {formError ? <Alert variant="destructive">{formError}</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Supplier and delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="supplierId" label="Supplier" required>
            {/* Searchable, not a capped list — see PartyPicker. */}
            <PartyPicker
              kind="supplier"
              id="supplierId"
              label="Supplier"
              placeholder="Choose a supplier…"
              value={supplier}
              onSelect={(s) => setSupplier(s)}
            />
          </Field>
          <Field id="branchId" label="Received at branch" required>
            <AppSelect
              id="branchId"
              label="Received at branch"
              value={branchId}
              onValueChange={setBranchId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </Field>
          <Field id="purchaseDate" label="Purchase date">
            <Input
              id="purchaseDate"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </Field>
          <Field
            id="supplierInvoiceNumber"
            label="Supplier bill number"
            hint="Their number, not ours"
          >
            <Input
              id="supplierInvoiceNumber"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {lines.map((line, index) => {
        const product = line.product
        const isSerial = product?.identifierType === 'SERIAL'
        const label = isSerial ? 'Serial number' : 'IMEI'

        return (
          <Card key={line.key} data-testid="purchase-line">
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-sm">Line {index + 1}</CardTitle>
                {product?.isSerialised ? (
                  <CardDescription>
                    Each unit is registered individually — one {label.toLowerCase()} per unit.
                  </CardDescription>
                ) : null}
              </div>
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field id={`product-${line.key}`} label="Product" required className="lg:col-span-2">
                  <ProductPicker
                    id={`product-${line.key}`}
                    label={`Line ${index + 1} product`}
                    value={line.product}
                    onSelect={(p) =>
                      update(line.key, {
                        product: p,
                        unitCost: p.purchasePricePaise
                          ? String(Number(p.purchasePricePaise) / 100)
                          : line.unitCost,
                        identifiers: p.isSerialised
                          ? Array(Math.max(1, Number(line.quantity) || 1)).fill('')
                          : [],
                      })
                    }
                  />
                </Field>
                <Field id={`qty-${line.key}`} label="Quantity" required>
                  <Input
                    id={`qty-${line.key}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                  />
                </Field>
                <Field id={`cost-${line.key}`} label="Unit cost (₹)" required>
                  <Input
                    id={`cost-${line.key}`}
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(e) => update(line.key, { unitCost: e.target.value })}
                  />
                </Field>
              </div>

              {product?.isSerialised ? (
                <>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">Main type</span>
                    <div className="flex flex-wrap gap-2">
                      {MAIN_TYPES.map((t) => (
                        <Button
                          key={t}
                          type="button"
                          size="sm"
                          variant={line.mainType === t ? 'default' : 'outline'}
                          onClick={() => update(line.key, { mainType: t })}
                        >
                          {t}
                        </Button>
                      ))}
                      {line.mainType === 'GLOBAL' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={line.isNewCut ? 'default' : 'outline'}
                          onClick={() => update(line.key, { isNewCut: !line.isNewCut })}
                        >
                          NEW CUT
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/*
                    The capture grid. One box per unit, so scanning twenty
                    handsets is twenty scans and one save - and the count can
                    never disagree with the quantity.
                  */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {label}s
                        <Badge variant="muted" className="ml-2">
                          {line.identifiers.filter((v) => v.trim()).length} of{' '}
                          {line.identifiers.length}
                        </Badge>
                      </span>
                    </div>
                    <div
                      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                      data-testid={`identifier-grid-${index}`}
                    >
                      {line.identifiers.map((value, i) => (
                        <Input
                          key={i}
                          className="font-mono"
                          inputMode={isSerial ? 'text' : 'numeric'}
                          placeholder={`${label} ${i + 1}`}
                          aria-label={`Line ${index + 1} ${label} ${i + 1}`}
                          value={value}
                          onChange={(e) => {
                            const next = [...line.identifiers]
                            next[i] = e.target.value
                            update(line.key, { identifiers: next })
                          }}
                          onKeyDown={(e) => {
                            // A scanner sends Enter after each read; jump to
                            // the next box so a box of twenty is one pass.
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const grid = e.currentTarget.closest('[data-testid^="identifier-grid"]')
                              const inputs = grid?.querySelectorAll('input')
                              ;(inputs?.[i + 1] as HTMLInputElement | undefined)?.focus()
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        )
      })}

      <Button type="button" variant="outline" onClick={() => setLines((p) => [...p, newLine()])}>
        <Plus className="size-4" />
        Add another line
      </Button>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Field id="notes" label="Notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular text-right">{formatMoney(totals.subtotal)}</dd>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular text-right">−{formatMoney(totals.discount)}</dd>
            <dt className="font-medium">Total</dt>
            <dd className="tabular text-right font-medium">{formatMoney(total)}</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
          <Link href="/purchases">Cancel</Link>
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={saving} className="w-full sm:w-auto">
          {saving ? 'Saving…' : 'Confirm purchase'}
        </Button>
      </div>
    </div>
  )
}
