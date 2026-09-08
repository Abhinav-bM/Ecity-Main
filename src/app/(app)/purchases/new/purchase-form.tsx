'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
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
import { BarcodeScanner } from '@/components/barcode-scanner'
import { PartyPicker, type PickedParty } from '@/components/party-picker'
import { AppSelect } from '@/components/app-select'

/**
 * One handset on a serialised line.
 *
 * The specs are here as well as on the line because a shipment is *mostly*
 * uniform: the line fills these in and a unit says only how it differs.
 * Battery health has no line default - on used stock it is different on every
 * piece, and a default would be a number somebody trusted.
 */
type Unit = {
  identifier: string
  variant: string
  ram: string
  storage: string
  colour: string
  battery: string
}

type Line = {
  key: string
  product: PickedProduct | null
  quantity: string
  unitCost: string
  sellingPrice: string
  discount: string
  mainType: (typeof MAIN_TYPES)[number]
  isNewCut: boolean
  /** Stamped onto every unit on this line that does not override it. */
  variant: string
  ram: string
  storage: string
  colour: string
  warrantyMonths: string
  warrantyProvider: string
  /** One per unit. Length must equal quantity for a serialised line. */
  units: Unit[]
}

const newUnit = (): Unit => ({
  identifier: '',
  variant: '',
  ram: '',
  storage: '',
  colour: '',
  battery: '',
})

let counter = 0
const newLine = (): Line => ({
  key: `l${counter++}`,
  product: null,
  quantity: '1',
  unitCost: '',
  sellingPrice: '',
  discount: '0',
  mainType: 'NEW',
  isNewCut: false,
  variant: '',
  ram: '',
  storage: '',
  colour: '',
  warrantyMonths: '',
  warrantyProvider: '',
  units: [newUnit()],
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
  /** Which unit rows have their own specs showing, as `lineKey:index`. */
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set())
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
          const have = next.units.length
          if (want > have) {
            next.units = [...next.units, ...Array.from({ length: want - have }, newUnit)]
          } else if (want < have) {
            next.units = next.units.slice(0, want)
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
        const filled = l.units.filter((u) => u.identifier.trim()).length
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
            sellingPrice: l.sellingPrice,
            discount: l.discount || 0,
            identifiers: [],
            units: product.isSerialised
              ? l.units
                  .filter((u) => u.identifier.trim())
                  .map((u) => ({
                    identifier: u.identifier.trim(),
                    variant: u.variant,
                    ram: u.ram,
                    storage: u.storage,
                    colour: u.colour,
                    batteryHealthPercent: u.battery,
                  }))
              : [],
            ...(product.isSerialised
              ? {
                  mainType: l.mainType,
                  isNewCut: l.isNewCut,
                  variant: l.variant,
                  ram: l.ram,
                  storage: l.storage,
                  colour: l.colour,
                  warrantyMonths: l.warrantyMonths,
                  warrantyProvider: l.warrantyProvider,
                }
              : {}),
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
              <div className="flex items-center gap-1">
                {/*
                  A mixed shipment is the same phone in four storages. Copying
                  the line keeps the product, cost and specs and clears the
                  identifiers, so the second combination is two edits rather
                  than a second full entry.
                */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Duplicate line ${index + 1}`}
                  onClick={() =>
                    setLines((prev) => {
                      const at = prev.findIndex((l) => l.key === line.key)
                      const copy: Line = {
                        ...line,
                        key: `l${counter++}`,
                        units: line.units.map(() => newUnit()),
                      }
                      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)]
                    })
                  }
                >
                  <Copy className="size-4" />
                </Button>
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
              </div>
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
                        sellingPrice: p.sellingPricePaise
                          ? String(Number(p.sellingPricePaise) / 100)
                          : line.sellingPrice,
                        units: p.isSerialised
                          ? Array.from(
                              { length: Math.max(1, Number(line.quantity) || 1) },
                              newUnit,
                            )
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
                {/*
                  Beside the cost, because the moment stock arrives is when
                  somebody knows both numbers. Left blank, the till falls back
                  to the product's list price rather than showing nothing.
                */}
                <Field
                  id={`price-${line.key}`}
                  label="Selling price (₹)"
                  hint="Blank uses the product's list price"
                >
                  <Input
                    id={`price-${line.key}`}
                    inputMode="decimal"
                    value={line.sellingPrice}
                    onChange={(e) => update(line.key, { sellingPrice: e.target.value })}
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
                    The specs the goods arrived with, entered where they
                    arrive. A line is one combination anyway - its unit cost
                    is a single number, and a 256GB does not cost what a
                    128GB costs - so these belong to the line and stamp every
                    handset on it.
                  */}
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">
                      Specs for this line
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        every {label === 'IMEI' ? 'handset' : 'unit'} on the line gets these
                      </span>
                    </span>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field id={`ram-${line.key}`} label="RAM">
                        <Input
                          id={`ram-${line.key}`}
                          placeholder="8 GB"
                          value={line.ram}
                          onChange={(e) => update(line.key, { ram: e.target.value })}
                        />
                      </Field>
                      <Field id={`storage-${line.key}`} label="Storage">
                        <Input
                          id={`storage-${line.key}`}
                          placeholder="256 GB"
                          value={line.storage}
                          onChange={(e) => update(line.key, { storage: e.target.value })}
                        />
                      </Field>
                      <Field id={`colour-${line.key}`} label="Colour">
                        <Input
                          id={`colour-${line.key}`}
                          placeholder="Green"
                          value={line.colour}
                          onChange={(e) => update(line.key, { colour: e.target.value })}
                        />
                      </Field>
                      <Field id={`variant-${line.key}`} label="Variant">
                        <Input
                          id={`variant-${line.key}`}
                          placeholder="Pro Max"
                          value={line.variant}
                          onChange={(e) => update(line.key, { variant: e.target.value })}
                        />
                      </Field>
                      {/*
                        PRD FR-29.1. A warranty typed in a month later is a
                        warranty nobody typed in — and the expiry is counted
                        from the purchase date, which is on this form already.
                      */}
                      <Field id={`warranty-${line.key}`} label="Warranty (months)">
                        <Input
                          id={`warranty-${line.key}`}
                          inputMode="numeric"
                          placeholder="12"
                          value={line.warrantyMonths}
                          onChange={(e) => update(line.key, { warrantyMonths: e.target.value })}
                        />
                      </Field>
                      <Field id={`warrantyBy-${line.key}`} label="Warranty by">
                        <Input
                          id={`warrantyBy-${line.key}`}
                          placeholder="Brand"
                          value={line.warrantyProvider}
                          onChange={(e) => update(line.key, { warrantyProvider: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>

                  {/*
                    The capture grid. One box per unit, so scanning twenty
                    handsets is twenty scans and one save - and the count can
                    never disagree with the quantity.

                    Each box opens onto that unit's own specs, for the piece
                    in the batch that is not like the others. Left closed it
                    stays a plain grid of boxes to scan into.
                  */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {label}s
                        <Badge variant="muted" className="ml-2">
                          {line.units.filter((u) => u.identifier.trim()).length} of{' '}
                          {line.units.length}
                        </Badge>
                      </span>
                    </div>
                    <div
                      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                      data-testid={`identifier-grid-${index}`}
                    >
                      {line.units.map((unit, i) => {
                        const patch = (change: Partial<Unit>) => {
                          const next = [...line.units]
                          next[i] = { ...next[i]!, ...change }
                          update(line.key, { units: next })
                        }
                        const openKey = `${line.key}:${i}`
                        const open = openUnits.has(openKey)
                        const differs =
                          unit.variant || unit.ram || unit.storage || unit.colour || unit.battery

                        return (
                          <div key={i} className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              <Input
                                data-identifier="true"
                                className="font-mono"
                                inputMode={isSerial ? 'text' : 'numeric'}
                                placeholder={`${label} ${i + 1}`}
                                aria-label={`Line ${index + 1} ${label} ${i + 1}`}
                                value={unit.identifier}
                                onChange={(e) => patch({ identifier: e.target.value })}
                                onKeyDown={(e) => {
                                  // A scanner sends Enter after each read; jump
                                  // to the next box so a box of twenty is one
                                  // pass. Only the identifier boxes, or an open
                                  // spec field would swallow the next scan.
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    const grid = e.currentTarget.closest(
                                      '[data-testid^="identifier-grid"]',
                                    )
                                    const boxes = grid?.querySelectorAll('input[data-identifier]')
                                    ;(boxes?.[i + 1] as HTMLInputElement | undefined)?.focus()
                                  }
                                }}
                              />
                              {/*
                                Booking in a delivery is where the most
                                identifiers get typed, so it is where a camera
                                saves the most. Fills this box only — the
                                person still sees what was read.
                              */}
                              <BarcodeScanner
                                label={`Scan ${label} ${i + 1} on line ${index + 1}`}
                                onScan={(value) => patch({ identifier: value })}
                              />
                              <Button
                                type="button"
                                variant={differs ? 'secondary' : 'ghost'}
                                size="icon"
                                aria-label={`Specs for ${label} ${i + 1} on line ${index + 1}`}
                                aria-expanded={open}
                                onClick={() =>
                                  setOpenUnits((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(openKey)) next.delete(openKey)
                                    else next.add(openKey)
                                    return next
                                  })
                                }
                              >
                                <SlidersHorizontal className="size-4" />
                              </Button>
                            </div>

                            {open ? (
                              <div className="grid gap-2 rounded-md border p-2">
                                <p className="text-xs text-muted-foreground">
                                  Only for this one. Blank means it takes the line&rsquo;s.
                                </p>
                                <Input
                                  aria-label={`${label} ${i + 1} RAM`}
                                  placeholder={line.ram || 'RAM'}
                                  value={unit.ram}
                                  onChange={(e) => patch({ ram: e.target.value })}
                                />
                                <Input
                                  aria-label={`${label} ${i + 1} storage`}
                                  placeholder={line.storage || 'Storage'}
                                  value={unit.storage}
                                  onChange={(e) => patch({ storage: e.target.value })}
                                />
                                <Input
                                  aria-label={`${label} ${i + 1} colour`}
                                  placeholder={line.colour || 'Colour'}
                                  value={unit.colour}
                                  onChange={(e) => patch({ colour: e.target.value })}
                                />
                                <Input
                                  aria-label={`${label} ${i + 1} variant`}
                                  placeholder={line.variant || 'Variant'}
                                  value={unit.variant}
                                  onChange={(e) => patch({ variant: e.target.value })}
                                />
                                <Input
                                  inputMode="numeric"
                                  aria-label={`${label} ${i + 1} battery health %`}
                                  placeholder="Battery health %"
                                  value={unit.battery}
                                  onChange={(e) => patch({ battery: e.target.value })}
                                />
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
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
