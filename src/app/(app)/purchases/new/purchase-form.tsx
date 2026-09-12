'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  MAIN_TYPES,
  parseQuantity,
  parseRupees,
  PURCHASE_SELLING_PRICE_REQUIRED,
  rupeesToPaise,
} from '@/lib/validation'
import { formatMoney } from '@/lib/money'
import { shopDateString } from '@/lib/date'
import { FormError } from '@/components/form-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'
import { ProductPicker, type PickedProduct } from '@/components/product-picker'
import { NewProductDialog } from '@/components/new-product-dialog'
import { ConfirmPurchaseDialog } from './confirm-dialog'
import { NewPartyDialog, splitTypedTerm } from '@/components/new-party-dialog'
import { BarcodeScanner } from '@/components/barcode-scanner'
import { PartyPicker, type PickedParty } from '@/components/party-picker'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/app-select'
import { WARRANTY_PROVIDERS } from '@/lib/warranty'
import { apiFetch } from '@/lib/api'

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
  /** Only asked for where the category wants one beside the IMEI. */
  serialNumber: string
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
  ram: string
  storage: string
  colour: string
  /**
   * The day cover ends (PRD FR-29.1).
   *
   * A date rather than a period: a used handset is sold with "covered until
   * the 14th", and a period only answers that after arithmetic against a start
   * date the buyer never agreed. NEW stock does not carry one here at all -
   * its cover is the manufacturer's, and it is billed in the other system.
   */
  warrantyUntil: string
  warrantyProvider: string
  /** One per unit. Length must equal quantity for a serialised line. */
  units: Unit[]
}

const newUnit = (): Unit => ({
  identifier: '',
  serialNumber: '',
  ram: '',
  storage: '',
  colour: '',
  battery: '',
})

/** The day after a yyyy-mm-dd, for a date box that must be strictly later. */
function dayAfter(day: string): string | undefined {
  if (!day) return undefined
  const at = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return undefined
  at.setUTCDate(at.getUTCDate() + 1)
  return at.toISOString().slice(0, 10)
}

let counter = 0
/**
 * A blank line, starting from the main type already in use on this purchase.
 *
 * A shipment is nearly always all one kind - a box of used handsets, or a box
 * of new ones - so resetting every added line to NEW meant re-picking the same
 * answer on line after line, and the one that got missed was booked in as the
 * wrong type. Inheriting is not the same as deciding for the shopkeeper: the
 * selector is still there on every line and still changes only that line.
 *
 * NEW CUT is deliberately NOT carried over. It is a per-handset designation
 * inside GLOBAL, not a property of the shipment, and silently inheriting it
 * would put it on stock nobody looked at.
 */
const newLine = (mainType: (typeof MAIN_TYPES)[number] = 'NEW'): Line => ({
  key: `l${counter++}`,
  product: null,
  quantity: '1',
  unitCost: '',
  sellingPrice: '',
  discount: '0',
  mainType,
  isNewCut: false,
  ram: '',
  storage: '',
  colour: '',
  warrantyUntil: '',
  warrantyProvider: '',
  units: [newUnit()],
})

export function PurchaseForm({
  branches,
  defaultBranchId,
  canCreateProduct,
  canCreateSupplier,
  taxRates,
  gstEnabled,
  paymentMethods,
  canPay,
}: {
  branches: { id: number; code: string; name: string }[]
  defaultBranchId: number | null
  /** product.manage. Without it the quick-add would only ever 403. */
  canCreateProduct: boolean
  /** supplier.manage, for the same reason. */
  canCreateSupplier: boolean
  /** Active rates only, for the quick-create product dialog. */
  taxRates: { id: number; name: string }[]
  gstEnabled: boolean
  /** Active methods only, for settling the bill here. */
  paymentMethods: { id: number; name: string }[]
  /** supplier_payment.manage. Without it the payment block is not offered. */
  canPay: boolean
}) {
  const router = useRouter()
  const [supplier, setSupplier] = useState<PickedParty | null>(null)
  const [branchId, setBranchId] = useState(String(defaultBranchId ?? branches[0]?.id ?? ''))
  const [purchaseDate, setPurchaseDate] = useState(shopDateString())
  const [arrivedAt, setArrivedAt] = useState(shopDateString())
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine()])
  /** Which unit rows have their own specs showing, as `lineKey:index`. */
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set())
  /*
   * Settling the bill here rather than finding it again in the history.
   * Off by default - a delivery on credit is still the common case, and a
   * payment nobody meant to record is worse than one recorded a minute later.
   */
  const [payNow, setPayNow] = useState(false)
  const [paymentMethodId, setPaymentMethodId] = useState(String(paymentMethods[0]?.id ?? ''))
  /** Blank is the whole bill. The server decides what that is, not this. */
  const [payAmount, setPayAmount] = useState('')
  const [payReference, setPayReference] = useState('')

  /*
   * Identifiers typed more than once on this delivery.
   *
   * Only the camera guarded against this, and only within one line - a typed
   * IMEI, or the same handset entered on two lines, went through untouched.
   * The server does refuse it, but only once the whole purchase is submitted,
   * and the message then names a device it created moments earlier in the same
   * transaction, which reads as nonsense. Twenty boxes of digits is exactly
   * where a finger slips, so it is said here, against the box it was typed in.
   *
   * Compared case-insensitively and across every line, because a serial number
   * may carry letters and a duplicate is a duplicate wherever it sits.
   */
  const duplicateIdentifiers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of lines) {
      for (const u of l.units) {
        const value = u.identifier.trim().toUpperCase()
        if (!value) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([value]) => value))
  }, [lines])

  const isDuplicate = (identifier: string) => {
    const value = identifier.trim().toUpperCase()
    return value !== '' && duplicateIdentifiers.has(value)
  }
  const [formError, setFormError] = useState<string | null>(null)
  /*
   * Errors against the field that caused them, not only in the banner.
   *
   * Every check here used to `setFormError` and stop at the first one, so a
   * form with three problems reported one, at the top, describing a box that
   * might be scrolled off the screen - and fixing it revealed the next. These
   * are keyed `${lineKey}:${field}` for a line, or a plain name for the rest,
   * and every check runs so the whole form is marked in one go.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /** Drop the error on a field the moment its value changes. */
  function clearErrors(...keys: string[]) {
    setFieldErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev
      const next = { ...prev }
      for (const k of keys) delete next[k]
      return next
    })
  }
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /** Which line asked for a new product, and what it was searching for. */
  const [newProductFor, setNewProductFor] = useState<{ key: string; name: string } | null>(null)
  /** What the supplier search found nothing for, if anything. */
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string } | null>(null)

  /*
   * Putting a product on a line. Shared, because a product created from the
   * picker has to land on the line exactly as a chosen one does - prices
   * carried across, identifier slots opened if it is serialised.
   */
  function selectProduct(key: string, p: PickedProduct) {
    clearErrors(`${key}:product`, `${key}:unitCost`, `${key}:sellingPrice`)
    const patch: Partial<Line> = { product: p }
    // Only what the product actually knows: a blank price must not wipe a
    // cost the buyer has already typed against this line.
    if (p.purchasePricePaise) patch.unitCost = String(Number(p.purchasePricePaise) / 100)
    if (p.sellingPricePaise) patch.sellingPrice = String(Number(p.sellingPricePaise) / 100)
    // Serialised lines get their identifier slots from update(), which keeps
    // one per unit; anything else carries none.
    if (!p.isSerialised) patch.units = []
    update(key, patch)
  }

  function update(key: string, patch: Partial<Line>) {
    clearErrors(...Object.keys(patch).map((field) => `${key}:${field}`))
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }

        // The identifier grid always has exactly one slot per unit, so the
        // count can never silently disagree with the quantity.
        if (next.product?.isSerialised) {
          const want = parseQuantity(next.quantity, { max: 999 })
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
      // Sanitised before they reach BigInt: a half-typed "1.5" or a pasted
      // "1e400" in one of these boxes would otherwise throw inside a render.
      const qty = BigInt(parseQuantity(l.quantity, { min: 0 }))
      const cost = rupeesToPaise(parseRupees(l.unitCost))
      const disc = rupeesToPaise(parseRupees(l.discount))
      return { subtotal: acc.subtotal + cost * qty, discount: acc.discount + disc }
    },
    { subtotal: 0n, discount: 0n },
  )
  const total = totals.subtotal - totals.discount

  /*
   * What would still be owed after the amount typed into the payment box.
   *
   * `null` while there is nothing useful to say - the box is empty (which means
   * the whole bill, so nothing is left), or what is in it is not a number yet.
   * Clamped at zero: an over-payment is refused on submit, and a negative
   * "still to pay" would be a stranger thing to show than the error.
   */
  const payPending = useMemo(() => {
    if (!payNow || !payAmount.trim()) return null
    const paid = rupeesToPaise(parseRupees(payAmount))
    if (paid <= 0n) return null
    return paid >= total ? 0n : total - paid
  }, [payNow, payAmount, total])

  /**
   * Every problem on the form at once, against the field that caused it.
   *
   * Returns the map rather than setting it, so the caller decides what to do
   * with an empty one. Nothing here returns early: a buyer who has mistyped
   * two lines should see both marked, not be walked through them one round
   * trip at a time.
   */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {}

    if (!supplier) errors.supplier = 'Choose a supplier.'
    if (!branchId) errors.branchId = 'Choose a branch.'

    for (const l of lines) {
      const product = l.product
      if (!product) {
        errors[`${l.key}:product`] = 'Choose a product.'
        continue
      }

      if (parseQuantity(l.quantity, { min: 0 }) < 1) {
        errors[`${l.key}:quantity`] = 'At least 1.'
      }

      /*
       * Both prices are required. A blank box used to reach the server as a
       * confident 0, so a delivery could be booked in at no cost at all and
       * the stock valuation carried a zero nobody typed. A deliberate 0 is
       * still fine - free replacement stock is a real thing.
       */
      if (!l.unitCost.trim()) {
        errors[`${l.key}:unitCost`] = 'Enter the unit cost.'
      } else if (parseRupees(l.unitCost) < 0) {
        errors[`${l.key}:unitCost`] = 'Cannot be negative.'
      }
      // Required only while the flag says so; a blank one is legitimate
      // otherwise, and the till falls back to the product's list price.
      if (PURCHASE_SELLING_PRICE_REQUIRED && !l.sellingPrice.trim()) {
        errors[`${l.key}:sellingPrice`] = 'Enter the selling price.'
      } else if (l.sellingPrice.trim() && parseRupees(l.sellingPrice) < 0) {
        errors[`${l.key}:sellingPrice`] = 'Cannot be negative.'
      }

      /*
       * Cover has to end after it starts. Compared as yyyy-mm-dd strings,
       * which sort correctly as dates, against the bill date rather than
       * today - booking in is routinely backdated, and a warranty that lapsed
       * before the goods were entered is a real thing to record.
       */
      if (l.warrantyUntil && purchaseDate && l.warrantyUntil <= purchaseDate) {
        errors[`${l.key}:warrantyUntil`] =
          `Has to end after the bill date (${purchaseDate}). Leave it blank if there is none.`
      }

      if (product.isSerialised) {
        const filled = l.units.filter((u) => u.identifier.trim()).length
        const qty = parseQuantity(l.quantity, { min: 0 })
        if (filled !== qty) {
          const what = product.identifierType === 'SERIAL' ? 'serial number' : 'IMEI'
          errors[`${l.key}:identifiers`] =
            `${qty} unit${qty === 1 ? '' : 's'} but ${filled} ${what}${filled === 1 ? '' : 's'} entered. Each unit needs its own.`
        }
      }
    }

    /*
     * Caught here rather than after a round trip that would have written the
     * purchase and then refused the payment - which the transaction rolls back
     * wholesale, so the buyer loses the whole delivery over a typo.
     */
    if (payNow) {
      if (!paymentMethodId) errors['payment:method'] = 'Choose how the bill was paid.'
      if (payAmount.trim()) {
        // parseRupees answers 0 for anything unparseable, so one check covers both.
        const amount = parseRupees(payAmount)
        if (amount <= 0) {
          errors['payment:amount'] = 'Has to be above zero. Leave it blank for the whole bill.'
        } else if (rupeesToPaise(amount) > total) {
          errors['payment:amount'] =
            `More than the bill total (${formatMoney(total)}).`
        }
      }
    }

    return errors
  }

  /**
   * The Confirm button. Validates, then asks - it never writes directly.
   *
   * Fields are checked first so the dialog only ever appears over a form that
   * would actually go through; being asked "are you sure" and then told about
   * a blank price box would be two interruptions for one mistake.
   */
  function requestConfirm() {
    setFormError(null)
    setFieldErrors({})

    if (duplicateIdentifiers.size > 0) {
      const shown = [...duplicateIdentifiers].slice(0, 3).join(', ')
      const more = duplicateIdentifiers.size - Math.min(3, duplicateIdentifiers.size)
      setFormError(
        `The same identifier is entered more than once: ${shown}${more > 0 ? `, and ${more} more` : ''}. Every unit needs its own.`,
      )
      return
    }

    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      const n = Object.keys(errors).length
      setFormError(
        n === 1
          ? 'One field needs attention — it is marked below.'
          : `${n} fields need attention — they are marked below.`,
      )
      return
    }

    setConfirming(true)
  }

  /** Writes the purchase. Only ever reached through the confirmation step. */
  async function submit() {
    setSaving(true)
    const res = await apiFetch('/api/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplierId: supplier?.id,
        branchId,
        purchaseDate,
        arrivedAt,
        supplierInvoiceNumber,
        notes,
        payment: payNow
          ? {
              paymentMethodId,
              // Blank travels as blank: the server settles the whole bill from
              // its own total, so the two can never disagree by a paisa.
              amount: payAmount.trim(),
              reference: payReference,
            }
          : undefined,
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
                    serialNumber: u.serialNumber.trim() || undefined,
                    ram: u.ram,
                    storage: u.storage,
                    colour: u.colour,
                    batteryHealthPercent: u.battery,
                  }))
              : [],
            // Sent on every line now, not only serialised ones.
            mainType: l.mainType,
            ...(product.isSerialised
              ? {
                  isNewCut: l.isNewCut,
                  ram: l.ram,
                  storage: l.storage,
                  colour: l.colour,
                  // NEW carries no warranty here; anything already typed
                  // before the type was switched is deliberately not sent.
                  warrantyUntil: l.mainType === 'NEW' ? '' : l.warrantyUntil,
                  warrantyProvider: l.mainType === 'NEW' ? '' : l.warrantyProvider,
                }
              : {}),
          }
        }),
      }),
    })
    setSaving(false)

    if (!res.ok) {
      // Out of the way, so the message is not behind a dialog.
      setConfirming(false)
      setFormError(res.error)
      return
    }
    const created = (res.data) as {
      purchaseNumber: string
      id: number
      paymentId: number | null
    }
    toast.success(
      created.paymentId
        ? `Purchase ${created.purchaseNumber} recorded and paid.`
        : `Purchase ${created.purchaseNumber} recorded.`,
    )
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

      <FormError message={formError} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Supplier and delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="supplierId" label="Supplier" required error={fieldErrors.supplier}>
            {/* Searchable, not a capped list — see PartyPicker. */}
            <PartyPicker
              kind="supplier"
              id="supplierId"
              label="Supplier"
              placeholder="Choose a supplier…"
              value={supplier}
              onSelect={(s) => {
                clearErrors('supplier')
                clearErrors('supplier')
          setSupplier(s)
              }}
              onCreateNew={
                canCreateSupplier ? (query) => setNewSupplier(splitTypedTerm(query)) : undefined
              }
            />
          </Field>
          <Field id="branchId" label="Received at branch" required error={fieldErrors.branchId}>
            <AppSelect
              id="branchId"
              label="Received at branch"
              value={branchId}
              onValueChange={(v) => {
                clearErrors('branchId')
                setBranchId(v)
              }}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </Field>
          {/*
            Two dates, because they are two facts. The bill is dated when the
            supplier raised it - that is what their statement reconciles
            against, and what their warranty runs from. The goods land
            whenever they land, and that is when the stock became sellable.
            On a counter sale they are the same day, so arrival follows the
            bill until someone says otherwise.
          */}
          <Field id="purchaseDate" label="Purchase date" hint="The date on the supplier's bill.">
            <Input
              id="purchaseDate"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </Field>
          <Field
            id="arrivedAt"
            label="Arrived date"
            hint="When it reached the shop. Leave as is if it came the same day."
          >
            <Input
              id="arrivedAt"
              type="date"
              value={arrivedAt}
              onChange={(e) => setArrivedAt(e.target.value)}
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
        // A phone whose category also wants the serial off the box. The IMEI
        // stays the required one; this is the extra.
        const wantsSerial = product?.capturesSerial === true && !isSerial
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
                <Field
                  id={`product-${line.key}`}
                  label="Product"
                  required
                  error={fieldErrors[`${line.key}:product`]}
                  className="lg:col-span-2"
                >
                  <ProductPicker
                    id={`product-${line.key}`}
                    label={`Line ${index + 1} product`}
                    value={line.product}
                    onSelect={(p) => selectProduct(line.key, p)}
                    onCreateNew={
                      canCreateProduct
                        ? (query) => setNewProductFor({ key: line.key, name: query })
                        : undefined
                    }
                  />
                </Field>
                <Field
                  id={`qty-${line.key}`}
                  label="Quantity"
                  required
                  error={fieldErrors[`${line.key}:quantity`]}
                >
                  <Input
                    id={`qty-${line.key}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                  />
                </Field>
                <Field
                  id={`cost-${line.key}`}
                  label="Unit cost (₹)"
                  required
                  error={fieldErrors[`${line.key}:unitCost`]}
                >
                  <Input
                    id={`cost-${line.key}`}
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(e) => update(line.key, { unitCost: e.target.value })}
                  />
                </Field>
                {/*
                  Beside the cost, because the moment stock arrives is when
                  somebody knows both numbers. Whether it is compulsory is
                  PURCHASE_SELLING_PRICE_REQUIRED's call - off today, so a
                  blank one is fine and the till uses the product's list price.
                  Choosing a product carries its price across, so it is usually
                  already filled anyway.
                */}
                <Field
                  id={`price-${line.key}`}
                  label="Selling price (₹)"
                  required={PURCHASE_SELLING_PRICE_REQUIRED}
                  error={fieldErrors[`${line.key}:sellingPrice`]}
                  hint={
                    PURCHASE_SELLING_PRICE_REQUIRED
                      ? 'What this batch will be sold at'
                      : "Blank uses the product's list price"
                  }
                >
                  <Input
                    id={`price-${line.key}`}
                    inputMode="decimal"
                    value={line.sellingPrice}
                    onChange={(e) => update(line.key, { sellingPrice: e.target.value })}
                  />
                </Field>
              </div>

              {/*
                Main type is asked for on every line, handset or not: the shop
                buys accessories in the same distinctions, and a NEW batch of
                chargers is not the same purchase as a job lot of used ones.
                It is required on a serialised line, because it stamps every
                unit that line creates; on a counted line it is optional.
              */}
              {product ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">
                    Main type{product.isSerialised ? ' *' : ''}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {MAIN_TYPES.map((t) => (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={line.mainType === t ? 'default' : 'outline'}
                        /* A toggle group. Without this the selected type is
                           conveyed by colour alone, which a screen reader
                           cannot see. */
                        aria-pressed={line.mainType === t}
                        onClick={() => update(line.key, { mainType: t })}
                      >
                        {t}
                      </Button>
                    ))}
                    {/*
                      NEW CUT stays a handset designation. It describes a
                      physical phone, and the database keeps it to GLOBAL
                      lines; offering it on a box of cables would be noise.
                    */}
                    {product.isSerialised && line.mainType === 'GLOBAL' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={line.isNewCut ? 'default' : 'outline'}
                        aria-pressed={line.isNewCut}
                        onClick={() => update(line.key, { isNewCut: !line.isNewCut })}
                      >
                        NEW CUT
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {product?.isSerialised ? (
                <>
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
                      {/*
                        PRD FR-29.1. A warranty typed in a month later is a
                        warranty nobody typed in, so it is asked for here.
                        Not for NEW: that cover is the manufacturer's, runs
                        from the customer's invoice, and the handset is billed
                        in the other system anyway.
                      */}
                      {line.mainType === 'NEW' ? null : (
                        <>
                          <Field
                            id={`warranty-${line.key}`}
                            label="Warranty until"
                            error={fieldErrors[`${line.key}:warrantyUntil`]}
                            hint="The day cover ends. Leave blank if none."
                          >
                            <Input
                              id={`warranty-${line.key}`}
                              type="date"
                              // The day after the bill: cover cannot end on
                              // the day the goods were bought.
                              min={dayAfter(purchaseDate)}
                              value={line.warrantyUntil}
                              onChange={(e) => update(line.key, { warrantyUntil: e.target.value })}
                            />
                          </Field>
                          <Field id={`warrantyBy-${line.key}`} label="Warranty by">
                            <AppSelect
                              id={`warrantyBy-${line.key}`}
                              label="Warranty by"
                              value={line.warrantyProvider}
                              onValueChange={(v) => update(line.key, { warrantyProvider: v })}
                              allowEmpty
                              emptyLabel="Not recorded"
                              placeholder="Not recorded"
                              options={[...WARRANTY_PROVIDERS]}
                            />
                          </Field>
                        </>
                      )}
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {label}s
                        <Badge
                          variant={
                            fieldErrors[`${line.key}:identifiers`] ? 'destructive' : 'muted'
                          }
                          className="ml-2"
                        >
                          {line.units.filter((u) => u.identifier.trim()).length} of{' '}
                          {line.units.length}
                        </Badge>
                      </span>
                      {/*
                        Scan the whole box in one sitting. Each read drops into
                        the next empty slot, so a delivery of twenty handsets
                        is one camera session rather than twenty — which is
                        the difference between using this and not bothering.
                      */}
                      <BarcodeScanner
                        continuous
                        label={`Scan every ${label} for line ${index + 1}`}
                        alreadyHave={line.units.map((u) => u.identifier).filter(Boolean)}
                        remaining={line.units.filter((u) => !u.identifier.trim()).length}
                        onScan={(value) => {
                          setLines((rows) =>
                            rows.map((l) => {
                              if (l.key !== line.key) return l
                              // Already on this line? A second look at the
                              // same box is not a second handset.
                              if (l.units.some((u) => u.identifier.trim() === value)) return l
                              const next = [...l.units]
                              const slot = next.findIndex((u) => !u.identifier.trim())
                              if (slot === -1) return l
                              next[slot] = { ...next[slot]!, identifier: value }
                              return { ...l, units: next }
                            }),
                          )
                        }}
                      />
                    </div>
                    {fieldErrors[`${line.key}:identifiers`] ? (
                      <p className="text-xs text-destructive" role="alert">
                        {fieldErrors[`${line.key}:identifiers`]}
                      </p>
                    ) : null}
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
                          unit.ram || unit.storage || unit.colour || unit.battery
                        const dupe = isDuplicate(unit.identifier)

                        return (
                          <div key={i} className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              <Input
                                data-identifier="true"
                                className={cn(
                                  'font-mono',
                                  dupe && 'border-destructive focus-visible:ring-destructive',
                                )}
                                inputMode={isSerial ? 'text' : 'numeric'}
                                placeholder={`${label} ${i + 1}`}
                                aria-label={`Line ${index + 1} ${label} ${i + 1}`}
                                aria-invalid={dupe || undefined}
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

                            {/*
                              Said against the box it was typed into. Both
                              copies are marked, because which of the two is
                              the mistake is the buyer's to decide.
                            */}
                            {dupe ? (
                              <p className="text-xs text-destructive">
                                {/* "imei" reads as a typo; the acronym keeps its case. */}
                                This {isSerial ? 'serial number' : 'IMEI'} is already on this
                                purchase.
                              </p>
                            ) : null}

                            {/*
                              The serial off the box, where the category asks
                              for one. Beneath the IMEI rather than beside it,
                              because it is the optional half: a handset with
                              no serial to hand still books in, and a row that
                              refused to save without one would have people
                              typing anything to get past it.
                            */}
                            {wantsSerial ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  className="font-mono text-xs"
                                  placeholder={`Serial ${i + 1} (optional)`}
                                  aria-label={`Line ${index + 1} serial ${i + 1}`}
                                  value={unit.serialNumber}
                                  onChange={(e) => patch({ serialNumber: e.target.value })}
                                />
                                <BarcodeScanner
                                  label={`Scan serial ${i + 1} on line ${index + 1}`}
                                  onScan={(value) => patch({ serialNumber: value })}
                                />
                              </div>
                            ) : null}

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

      <Button
        type="button"
        variant="outline"
        onClick={() => setLines((p) => [...p, newLine(p[p.length - 1]?.mainType)])}
      >
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

          {canPay ? (
            <div className="space-y-3 rounded-md border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <Switch
                  checked={payNow}
                  onCheckedChange={setPayNow}
                  disabled={paymentMethods.length === 0}
                  aria-label="Mark as paid"
                />
                Mark as paid
              </label>

              {paymentMethods.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This shop has no active payment methods, so a bill cannot be settled here.
                  Add one under Settings → Business → Payments.
                </p>
              ) : !payNow ? (
                <p className="text-xs text-muted-foreground">
                  Leave this off if the delivery is on credit. The bill goes onto the
                  supplier&rsquo;s account and can be paid later.
                </p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field id="payment-method" label="Payment method" error={fieldErrors['payment:method']}>
                      <AppSelect
                        id="payment-method"
                        label="Payment method"
                        value={paymentMethodId}
                        onValueChange={(v) => {
                          clearErrors('payment:method')
                          setPaymentMethodId(v)
                        }}
                        placeholder="Choose a method"
                        options={paymentMethods.map((m) => ({ value: String(m.id), label: m.name }))}
                      />
                    </Field>
                    <Field id="payment-amount" label="Amount paid" error={fieldErrors['payment:amount']}>
                      <Input
                        id="payment-amount"
                        inputMode="decimal"
                        aria-label="Amount paid"
                        placeholder={`Leave blank for ${formatMoney(total)}`}
                        value={payAmount}
                        onChange={(e) => {
                          clearErrors('payment:amount')
                          setPayAmount(e.target.value)
                        }}
                      />
                    </Field>
                    <Field id="payment-reference" label="Reference">
                      <Input
                        id="payment-reference"
                        aria-label="Payment reference"
                        placeholder="Optional"
                        value={payReference}
                        onChange={(e) => setPayReference(e.target.value)}
                      />
                    </Field>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <strong className="font-medium text-foreground">
                      Leave the amount blank if you paid the full bill
                    </strong>{' '}
                    — {formatMoney(total)}. Enter a smaller amount for a part payment.
                  </p>

                  {/*
                    What is still owed, worked out as they type. A part payment
                    whose balance you have to compute yourself is how a supplier
                    ends up chased for the wrong figure.
                  */}
                  {payPending !== null ? (
                    <dl
                      className="flex items-baseline justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                      data-testid="payment-pending"
                    >
                      <dt className="text-muted-foreground">
                        {payPending > 0n ? 'Still to pay the supplier' : 'Nothing left to pay'}
                      </dt>
                      <dd className="tabular font-medium">{formatMoney(payPending)}</dd>
                    </dl>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
          <Link href="/purchases">Cancel</Link>
        </Button>
        <Button type="button" onClick={requestConfirm} disabled={saving} className="w-full sm:w-auto">
          {saving ? 'Saving…' : 'Confirm purchase'}
        </Button>
      </div>

      <NewPartyDialog
        kind="supplier"
        open={newSupplier !== null}
        prefill={newSupplier ?? { name: '', phone: '' }}
        onOpenChange={(open) => {
          if (!open) setNewSupplier(null)
        }}
        onCreated={(s) => {
          setSupplier(s)
          setNewSupplier(null)
        }}
      />

      <ConfirmPurchaseDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void submit()}
        saving={saving}
        supplierName={supplier?.name ?? 'this supplier'}
        totalPaise={total}
      />

      <NewProductDialog
        open={newProductFor !== null}
        prefillName={newProductFor?.name ?? ''}
        taxRates={taxRates}
        gstEnabled={gstEnabled}
        onOpenChange={(open) => {
          if (!open) setNewProductFor(null)
        }}
        onCreated={(p) => {
          if (newProductFor) selectProduct(newProductFor.key, p)
          setNewProductFor(null)
        }}
      />
    </div>
  )
}
