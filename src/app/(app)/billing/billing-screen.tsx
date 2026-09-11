'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { computeBill } from '@/lib/tax'
import { formatMoney } from '@/lib/money'
import { MAX_QUANTITY, parseQuantity, parseRupees, rupeesToPaise } from '@/lib/validation'
import { shopDateString } from '@/lib/date'
import { useCart, type CartLine } from '@/stores/cart'
import { FormError } from '@/components/form-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MainTypeBadge } from '@/components/main-type-badge'
import { BillSearch, type DeviceHit, type ProductHit } from './bill-search'
import { CustomerPanel } from './customer-panel'
import { TradeInPanel } from './trade-in-panel'
import type { MainType } from '@/server/db/schema'
import { apiFetch } from '@/lib/api'

export function BillingScreen({
  branchId,
  branchName,
  canCreateCustomer,
  defaultCreditDays,
  paymentMethods,
  taxRates,
  canDiscount,
  gstEnabled,
  pricesIncludeTax,
}: {
  branchId: number
  branchName: string
  canCreateCustomer: boolean
  /** PRD FR-7.2. Prefills the due date on a credit bill. */
  defaultCreditDays: number
  paymentMethods: { id: number; name: string }[]
  taxRates: { id: number; rateBasisPoints: number }[]
  canDiscount: boolean
  /** Off for an unregistered shop: no tax on the bill, no tax on screen. */
  gstEnabled: boolean
  /*
   * The shop's own answer to "is the ticket price the price the customer
   * pays?". The till used to assume yes. On a shop that answers no, the
   * server added tax on top of a figure the screen had already shown as
   * final, so the saved bill came out above the price on the shelf - which
   * looks for all the world like the discount was added rather than taken off.
   */
  pricesIncludeTax: boolean
}) {
  const router = useRouter()
  const cart = useCart()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  /**
   * The store is persisted, and rehydration is asynchronous.
   *
   * Comparing the branch before rehydration finishes sees a null branch,
   * concludes the cart belongs elsewhere and wipes it - which destroyed the
   * half-built bill on every reload, the exact thing NFR §9.3 forbids.
   * So: wait for hydration, then decide.
   */
  useEffect(() => {
    if (useCart.persist.hasHydrated()) setHydrated(true)
    return useCart.persist.onFinishHydration(() => setHydrated(true))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    // Only a cart genuinely belonging to another branch is discarded; a fresh
    // one simply adopts this branch.
    if (cart.branchId !== null && cart.branchId !== branchId) cart.clear()
    if (useCart.getState().branchId !== branchId) cart.setBranch(branchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, branchId])

  const rateBp = useMemo(
    () => new Map(taxRates.map((r) => [r.id, r.rateBasisPoints])),
    [taxRates],
  )

  /*
   * Which lines have been given a discount bigger than they are worth.
   *
   * Checked here rather than left to computeBill, which *throws* on it. That
   * throw is right on the server - a bill worth less than nothing must not be
   * saved - but this runs inside a render, on every keystroke. Typing "500"
   * into the discount of a ₹300 line passes through a moment where the
   * discount exceeds the line, and the exception took the whole till down
   * mid-sale rather than saying the number was too big.
   */
  const overDiscounted = useMemo(() => {
    const over = new Map<string, bigint>()
    for (const l of cart.lines) {
      const gross = rupeesToPaise(parseRupees(l.unitPrice)) * BigInt(parseQuantity(l.quantity))
      // Carries the most that can come off, so the line can name the figure
      // rather than describe it. "Worth" read as worth-to-the-shop, which is
      // a different question entirely - this has nothing to do with cost.
      if (rupeesToPaise(parseRupees(l.discount)) > gross) over.set(l.key, gross)
    }
    return over
  }, [cart.lines])

  const totals = useMemo(
    () =>
      computeBill(
        cart.lines.map((l) => {
          const unitPricePaise = rupeesToPaise(parseRupees(l.unitPrice))
          // Whatever is in the box right now, made safe to compute with:
          // computeBill throws on a fractional quantity and BigInt refuses an
          // infinite one, and both of those are a keystroke away.
          const quantity = parseQuantity(l.quantity)
          const gross = unitPricePaise * BigInt(quantity)
          const discountPaise = rupeesToPaise(parseRupees(l.discount))
          return {
            unitPricePaise,
            quantity,
            // Capped for the preview only. The line is already flagged above
            // and Save is blocked, so this figure is never what gets sent -
            // it just keeps a total on screen while the number is corrected.
            discountPaise: discountPaise > gross ? gross : discountPaise,
            taxRateBasisPoints: l.taxRateBasisPoints,
          }
        }),
        // The server recomputes from these same inputs and this same
        // setting, so the figure on screen is the figure that gets saved.
        pricesIncludeTax,
      ),
    [cart.lines, pricesIncludeTax],
  )

  const paid = cart.payments.reduce((sum, p) => sum + rupeesToPaise(parseRupees(p.amount)), 0n)
  /*
   * PRD FR-9.2. A trade-in is not a discount on the bill - the invoice still
   * shows the full price of what was sold, and GST is charged on that. It
   * settles part of what is owed, exactly like a payment, so it belongs here
   * and not in the tax calculation.
   */
  const tradeInPaise = cart.tradeIn ? BigInt(cart.tradeIn.valuePaise) : 0n
  const due = totals.totalPaise - paid - tradeInPaise

  function addDevice(hit: DeviceHit) {
    const result = cart.addLine({
      productId: hit.productId,
      productName: hit.productName,
      deviceId: hit.deviceId,
      identifier: hit.identifier,
      mainType: hit.mainType,
      isNewCut: hit.isNewCut,
      quantity: 1,
      unitPrice: hit.sellingPricePaise ? String(Number(hit.sellingPricePaise) / 100) : '',
      discount: '0',
      /*
       * No rate on the item means no tax. It does NOT mean "fall back to the
       * shop's default rate", which is what this used to do - so a product
       * deliberately saved as untaxed was still billed at the shop default,
       * and nothing on screen said so. `product.tax_rate_id` is nullable
       * precisely so that untaxed can be said, and the server already reads a
       * null rate as 0%; it was only the till filling the gap.
       */
      taxRateId: gstEnabled ? hit.taxRateId : null,
      taxRateBasisPoints: gstEnabled ? (rateBp.get(hit.taxRateId ?? -1) ?? 0) : 0,
      availableQuantity: null,
    })
    if (!result.added) toast.error(result.reason ?? 'Could not add that item.')
  }

  function addProduct(hit: ProductHit) {
    const result = cart.addLine({
      productId: hit.productId,
      productName: hit.productName,
      deviceId: null,
      identifier: null,
      mainType: null,
      isNewCut: false,
      quantity: 1,
      unitPrice: hit.sellingPricePaise ? String(Number(hit.sellingPricePaise) / 100) : '',
      discount: '0',
      /*
       * No rate on the item means no tax. It does NOT mean "fall back to the
       * shop's default rate", which is what this used to do - so a product
       * deliberately saved as untaxed was still billed at the shop default,
       * and nothing on screen said so. `product.tax_rate_id` is nullable
       * precisely so that untaxed can be said, and the server already reads a
       * null rate as 0%; it was only the till filling the gap.
       */
      taxRateId: gstEnabled ? hit.taxRateId : null,
      taxRateBasisPoints: gstEnabled ? (rateBp.get(hit.taxRateId ?? -1) ?? 0) : 0,
      availableQuantity: hit.quantity,
    })
    if (!result.added) toast.error(result.reason ?? 'Could not add that item.')
  }

  async function save() {
    setError(null)
    if (cart.lines.length === 0) {
      setError('Add something to the bill first.')
      return
    }
    if (due > 0n && !cart.customerId) {
      setError('An unpaid balance needs a customer — a walk-in cannot be given credit.')
      return
    }

    setSaving(true)
    const res = await apiFetch('/api/sales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branchId,
        customerId: cart.customerId,
        notes: cart.notes,
        // Only sent when something is left owing; the server ignores them
        // otherwise, and clears them on a fully paid bill.
        dueDate: due > 0n ? (cart.dueDate ?? undefined) : undefined,
        creditNotes: due > 0n ? cart.creditNotes || undefined : undefined,
        // Held in the store so a retry after a dropped connection returns the
        // same bill instead of charging twice.
        idempotencyKey: cart.idempotencyKey,
        // FR-9.2. Sent as its own field, not as a discount: the bill and its
        // GST stay at the full price and the agreed value settles part of it.
        tradeInId: cart.tradeIn?.id ?? null,
        // The sanitised figures, so what is sent is exactly what the totals
        // on screen were computed from - not the raw text of the box.
        lines: cart.lines.map((l) => ({
          productId: l.productId,
          deviceId: l.deviceId,
          quantity: parseQuantity(l.quantity),
          unitPrice: parseRupees(l.unitPrice),
          discount: parseRupees(l.discount),
          taxRateId: l.taxRateId,
        })),
        payments: cart.payments.map((p) => ({
          paymentMethodId: p.paymentMethodId,
          amount: parseRupees(p.amount),
          reference: p.reference,
        })),
      }),
    })
    setSaving(false)

    if (!res.ok) {
      setError(res.error)
      return
    }
    const saved = (res.data) as { id: number; invoiceNumber: string }
    cart.clear()
    toast.success(`Invoice ${saved.invoiceNumber} saved.`)
    router.push(`/sales/${saved.id}`)
    router.refresh()
  }

  // The shop's standard term, shown as the default so the salesperson only
  // touches the date when this customer is an exception.
  const defaultDueDate = useMemo(() => {
    const d = new Date(Date.now() + defaultCreditDays * 86_400_000)
    // The shop's calendar, not UTC - otherwise the terms shown overnight are
    // a day out from the ones the server records.
    return shopDateString(d)
  }, [defaultCreditDays])

  if (!hydrated) {
    return <p className="p-6 text-sm text-muted-foreground">Loading the counter…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Billing</h1>
          <p className="text-sm text-muted-foreground">
            {branchName} · scan or search, then take payment.
          </p>
        </div>
        {cart.lines.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => cart.clear()}>
            Clear bill
          </Button>
        ) : null}
      </div>

      <FormError message={error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-4">
          <BillSearch branchId={branchId} onPickDevice={addDevice} onPickProduct={addProduct} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Items{' '}
                <Badge variant="muted" className="ml-1">
                  {cart.lines.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing on the bill yet. Scan an IMEI or search a product.
                </p>
              ) : (
                <ul className="divide-y" data-testid="cart-lines">
                  {cart.lines.map((line) => (
                    <CartRow
                      key={line.key}
                      line={line}
                      canDiscount={canDiscount}
                      maxDiscountPaise={overDiscounted.get(line.key) ?? null}
                      onChange={(patch) => cart.updateLine(line.key, patch)}
                      onRemove={() => cart.removeLine(line.key)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <CustomerPanel
            canCreate={canCreateCustomer}
            selectedName={cart.customerName}
            selectedId={cart.customerId}
            onSelect={(id, name) => cart.setCustomer(id, name)}
          />

          <TradeInPanel
            branchId={branchId}
            customerId={cart.customerId}
            tradeIn={cart.tradeIn}
            onChange={(t) => cart.setTradeIn(t)}
          />

          {/*
            Credit terms appear only once the bill is actually short - asking
            for a due date on a cash sale is noise at a busy counter.
          */}
          {due > 0n ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Credit terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="due-date">Payment due</Label>
                  <Input
                    id="due-date"
                    type="date"
                    value={cart.dueDate ?? defaultDueDate}
                    onChange={(e) => cart.setCredit(e.target.value || null, cart.creditNotes)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="credit-notes">Note</Label>
                  <Input
                    id="credit-notes"
                    value={cart.creditNotes}
                    onChange={(e) => cart.setCredit(cart.dueDate, e.target.value)}
                    placeholder="Agreed with the owner…"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(due)} will be owed. Leave the date as it is to use the shop
                  default.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {/*
                  A discount only ever comes off. Showing it as its own line,
                  signed, is how the person at the till can see that.
                */}
                {totals.discountPaise > 0n ? (
                  <>
                    <dt className="text-muted-foreground">Items</dt>
                    <dd className="tabular text-right">{formatMoney(totals.subtotalPaise)}</dd>
                    <dt className="text-muted-foreground">Discount</dt>
                    <dd className="tabular text-right text-success">
                      −{formatMoney(totals.discountPaise)}
                    </dd>
                  </>
                ) : null}
                {/* No tax to break out when the shop is not registered. */}
                {gstEnabled ? (
                  <>
                    <dt className="text-muted-foreground">Taxable</dt>
                    <dd className="tabular text-right">{formatMoney(totals.taxablePaise)}</dd>
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="tabular text-right" data-testid="cart-tax">
                      {formatMoney(totals.taxPaise)}
                    </dd>
                  </>
                ) : null}
                <dt className="font-medium">Bill total</dt>
                <dd className="tabular text-right font-medium">
                  {formatMoney(totals.totalPaise)}
                </dd>
                {/*
                  The bill total stays the full price - the invoice and its GST
                  are for what was actually sold. The trade-in settles part of
                  it, like a payment does.
                */}
                {tradeInPaise > 0n ? (
                  <>
                    <dt className="text-muted-foreground">Trade-in</dt>
                    <dd className="tabular text-right">−{formatMoney(tradeInPaise)}</dd>
                  </>
                ) : null}
                {paid > 0n ? (
                  <>
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="tabular text-right">−{formatMoney(paid)}</dd>
                  </>
                ) : null}
                <dt className="text-base font-medium">
                  {due > 0n ? 'Still to pay' : 'Settled'}
                </dt>
                <dd className="tabular text-right text-base font-medium">
                  {formatMoney(due > 0n ? due : 0n)}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <PaymentPanel
            methods={paymentMethods}
            totalPaise={totals.totalPaise}
            paidPaise={paid}
            duePaise={due}
          />

          <Button
            className="h-11 w-full text-base"
            // A bill the server is certain to refuse should not be sendable.
            disabled={saving || cart.lines.length === 0 || overDiscounted.size > 0}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : `Save bill · ${formatMoney(totals.totalPaise)}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CartRow({
  line,
  canDiscount,
  maxDiscountPaise,
  onChange,
  onRemove,
}: {
  line: CartLine
  canDiscount: boolean
  /**
   * Set only when the discount is too big, to the most that could come off.
   * Said here, beside the box it was typed into.
   */
  maxDiscountPaise: bigint | null
  onChange: (patch: Partial<CartLine>) => void
  onRemove: () => void
}) {
  const overStock =
    line.availableQuantity != null && line.quantity > line.availableQuantity

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{line.productName}</p>
          {line.identifier ? (
            <p className="font-mono text-xs text-muted-foreground">{line.identifier}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {line.mainType ? (
            <MainTypeBadge mainType={line.mainType as MainType} isNewCut={line.isNewCut} />
          ) : null}
          <Button variant="ghost" size="sm" aria-label={`Remove ${line.productName}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`qty-${line.key}`} className="text-xs">
            Qty
          </Label>
          <Input
            id={`qty-${line.key}`}
            inputMode="numeric"
            className="h-9"
            // A device line is one physical unit; the quantity cannot change.
            disabled={line.deviceId !== null}
            max={MAX_QUANTITY}
            value={line.quantity}
            onChange={(e) => onChange({ quantity: parseQuantity(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`price-${line.key}`} className="text-xs">
            Price (₹)
          </Label>
          <Input
            id={`price-${line.key}`}
            inputMode="decimal"
            className="h-9"
            value={line.unitPrice}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
          />
        </div>
        {canDiscount ? (
          <div className="space-y-1">
            <Label htmlFor={`disc-${line.key}`} className="text-xs">
              Discount (₹)
            </Label>
            <Input
              id={`disc-${line.key}`}
              inputMode="decimal"
              className="h-9"
              value={line.discount}
              onChange={(e) => onChange({ discount: e.target.value })}
            />
          </div>
        ) : null}
      </div>

      {overStock ? (
        <p className="text-xs text-destructive">
          Only {line.availableQuantity} in stock at this branch.
        </p>
      ) : null}

      {maxDiscountPaise !== null ? (
        <p className="text-xs text-destructive">
          The most you can take off this line is {formatMoney(maxDiscountPaise)} — its price times
          the quantity. Any more and the line would come to less than nothing.
        </p>
      ) : null}
    </li>
  )
}

function PaymentPanel({
  methods,
  totalPaise,
  paidPaise,
  duePaise,
}: {
  methods: { id: number; name: string }[]
  totalPaise: bigint
  paidPaise: bigint
  duePaise: bigint
}) {
  const cart = useCart()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                cart.setPayments([
                  ...cart.payments,
                  {
                    key: `p${Date.now()}${m.id}`,
                    paymentMethodId: m.id,
                    methodName: m.name,
                    // Offer the outstanding amount, which is nearly always it.
                    amount: duePaise > 0n ? String(Number(duePaise) / 100) : '',
                    reference: '',
                  },
                ])
              }
            >
              + {m.name}
            </Button>
          ))}
        </div>

        {cart.payments.length > 0 ? (
          <ul className="space-y-2" data-testid="cart-payments">
            {cart.payments.map((p) => (
              <li key={p.key} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-sm">{p.methodName}</span>
                <Input
                  className="h-9"
                  inputMode="decimal"
                  aria-label={`${p.methodName} amount`}
                  value={p.amount}
                  onChange={(e) =>
                    cart.setPayments(
                      cart.payments.map((x) =>
                        x.key === p.key ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${p.methodName} payment`}
                  onClick={() => cart.setPayments(cart.payments.filter((x) => x.key !== p.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="grid grid-cols-2 gap-1 border-t pt-3 text-sm">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="tabular text-right">{formatMoney(paidPaise)}</dd>
          <dt className={duePaise > 0n ? 'font-medium text-warning-foreground' : 'text-muted-foreground'}>
            {duePaise > 0n ? 'On credit' : 'Change'}
          </dt>
          <dd className="tabular text-right font-medium">
            {formatMoney(duePaise > 0n ? duePaise : -duePaise)}
          </dd>
        </dl>
        {duePaise > 0n && totalPaise > 0n ? (
          <p className="text-xs text-muted-foreground">
            An unpaid balance becomes customer credit and needs a customer on the bill.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
