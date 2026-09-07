'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { computeBill } from '@/lib/tax'
import { formatMoney } from '@/lib/money'
import { rupeesToPaise } from '@/lib/validation'
import { useCart, type CartLine } from '@/stores/cart'
import { Alert } from '@/components/ui/alert'
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

export function BillingScreen({
  branchId,
  branchName,
  canCreateCustomer,
  defaultCreditDays,
  paymentMethods,
  defaultTaxRateId,
  taxRates,
  canDiscount,
  gstEnabled,
}: {
  branchId: number
  branchName: string
  canCreateCustomer: boolean
  /** PRD FR-7.2. Prefills the due date on a credit bill. */
  defaultCreditDays: number
  paymentMethods: { id: number; name: string }[]
  defaultTaxRateId: number | null
  taxRates: { id: number; rateBasisPoints: number }[]
  canDiscount: boolean
  /** Off for an unregistered shop: no tax on the bill, no tax on screen. */
  gstEnabled: boolean
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

  const totals = useMemo(
    () =>
      computeBill(
        cart.lines.map((l) => ({
          unitPricePaise: rupeesToPaise(Number(l.unitPrice) || 0),
          quantity: l.quantity,
          discountPaise: rupeesToPaise(Number(l.discount) || 0),
          taxRateBasisPoints: l.taxRateBasisPoints,
        })),
        // Matches the server: it recomputes from the same inputs, so the
        // figure on screen is the figure that gets saved.
        true,
      ),
    [cart.lines],
  )

  const paid = cart.payments.reduce((sum, p) => sum + rupeesToPaise(Number(p.amount) || 0), 0n)
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
      taxRateId: gstEnabled ? (hit.taxRateId ?? defaultTaxRateId) : null,
      taxRateBasisPoints: gstEnabled
        ? (rateBp.get(hit.taxRateId ?? defaultTaxRateId ?? -1) ?? 0)
        : 0,
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
      taxRateId: gstEnabled ? (hit.taxRateId ?? defaultTaxRateId) : null,
      taxRateBasisPoints: gstEnabled
        ? (rateBp.get(hit.taxRateId ?? defaultTaxRateId ?? -1) ?? 0)
        : 0,
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
    const res = await fetch('/api/sales', {
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
        lines: cart.lines.map((l) => ({
          productId: l.productId,
          deviceId: l.deviceId,
          quantity: l.quantity,
          unitPrice: l.unitPrice || 0,
          discount: l.discount || 0,
          taxRateId: l.taxRateId,
        })),
        payments: cart.payments.map((p) => ({
          paymentMethodId: p.paymentMethodId,
          amount: p.amount || 0,
          reference: p.reference,
        })),
      }),
    })
    setSaving(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not save the bill.')
      return
    }
    const saved = (await res.json()) as { id: number; invoiceNumber: string }
    cart.clear()
    toast.success(`Invoice ${saved.invoiceNumber} saved.`)
    router.push(`/sales/${saved.id}`)
    router.refresh()
  }

  // The shop's standard term, shown as the default so the salesperson only
  // touches the date when this customer is an exception.
  const defaultDueDate = useMemo(() => {
    const d = new Date(Date.now() + defaultCreditDays * 86_400_000)
    return d.toISOString().slice(0, 10)
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

      {error ? <Alert variant="destructive">{error}</Alert> : null}

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
                {/* No tax to break out when the shop is not registered. */}
                {gstEnabled ? (
                  <>
                    <dt className="text-muted-foreground">Taxable</dt>
                    <dd className="tabular text-right">{formatMoney(totals.taxablePaise)}</dd>
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="tabular text-right">{formatMoney(totals.taxPaise)}</dd>
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
            disabled={saving || cart.lines.length === 0}
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
  onChange,
  onRemove,
}: {
  line: CartLine
  canDiscount: boolean
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
            value={line.quantity}
            onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
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
