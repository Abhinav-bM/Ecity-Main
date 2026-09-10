'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/form-field'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/app-select'
import { MainTypeBadge } from '@/components/main-type-badge'
import { formatMoney } from '@/lib/money'
import { parseQuantity, parseRupees, rupeesToPaise } from '@/lib/validation'
import type { MainType } from '@/server/db/schema'
import { apiFetch } from '@/lib/api'

export type ReturnableLine = {
  id: number
  description: string | null
  identifierSnapshot: string | null
  mainTypeSnapshot: MainType | null
  isNewCutSnapshot: boolean
  deviceId: number | null
  quantity: number
  returnedQty: number
  remainingQty: number
  unitPricePaise: bigint
  lineTotalPaise: bigint
}

/**
 * Taking goods back (PRD FR-8.1).
 *
 * Only what is still returnable is offered — a line already returned in full
 * cannot be chosen at all, which is what stops the same goods coming back
 * twice.
 */
export function ReturnForm({
  saleId,
  invoiceNumber,
  customerName,
  lines,
  branches,
  methods,
  defaultBranchId,
  canRefund,
}: {
  saleId: number
  invoiceNumber: string
  customerName: string | null
  lines: ReturnableLine[]
  branches: { id: number; code: string; name: string }[]
  methods: { id: number; name: string }[]
  defaultBranchId: number | null
  canRefund: boolean
}) {
  const router = useRouter()
  const returnable = lines.filter((l) => l.remainingQty > 0)

  const [qty, setQty] = useState<Record<number, string>>({})
  const [branchId, setBranchId] = useState(String(defaultBranchId ?? branches[0]?.id ?? ''))
  const [reason, setReason] = useState('')
  const [deduction, setDeduction] = useState('')
  const [refundMethod, setRefundMethod] = useState(canRefund ? 'PAYMENT_METHOD' : 'NONE')
  const [methodId, setMethodId] = useState(String(methods[0]?.id ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen = useMemo(
    () =>
      returnable
        .map((l) => ({ line: l, n: parseQuantity(qty[l.id] ?? 0, { min: 0 }) }))
        .filter((x) => x.n > 0),
    [qty, returnable],
  )

  // Pro rata, matching what the server will compute.
  const goodsValue = chosen.reduce(
    (sum, { line, n }) => sum + (line.lineTotalPaise * BigInt(n)) / BigInt(line.quantity),
    0n,
  )
  const deductionPaise = rupeesToPaise(parseRupees(deduction))
  const refundable = goodsValue - deductionPaise

  async function submit() {
    setError(null)
    if (chosen.length === 0) {
      setError('Choose at least one item to return.')
      return
    }
    if (deductionPaise > goodsValue) {
      setError('The deduction is more than the goods are worth.')
      return
    }

    setBusy(true)
    const res = await apiFetch('/api/returns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        saleId,
        branchId: Number(branchId),
        lines: chosen.map(({ line, n }) => ({ saleItemId: line.id, quantity: n })),
        reason,
        deduction: parseRupees(deduction),
        refundMethod,
        paymentMethodId: refundMethod === 'PAYMENT_METHOD' ? Number(methodId) : undefined,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      setError(res.error)
      return
    }
    const { id, returnNumber } = (res.data) as { id: number; returnNumber: string }
    toast.success(`Return ${returnNumber} recorded.`)
    router.push(`/returns/${id}`)
  }

  if (returnable.length === 0) {
    return (
      <Alert>Everything on {invoiceNumber} has already been returned.</Alert>
    )
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            What is coming back
            <span className="ml-2 font-normal text-muted-foreground">
              {invoiceNumber}
              {customerName ? ` · ${customerName}` : ' · walk-in'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" data-testid="returnable-lines">
            {returnable.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p>{l.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.identifierSnapshot ? (
                      <span className="font-mono">{l.identifierSnapshot} · </span>
                    ) : null}
                    {formatMoney(l.unitPricePaise)} each · {l.remainingQty} of {l.quantity} left
                  </p>
                  {l.mainTypeSnapshot ? (
                    <MainTypeBadge mainType={l.mainTypeSnapshot} isNewCut={l.isNewCutSnapshot} />
                  ) : null}
                </div>
                <Input
                  className="h-8 w-24 text-right"
                  inputMode="numeric"
                  aria-label={`Return quantity for ${l.description ?? 'item'}`}
                  placeholder="0"
                  value={qty[l.id] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="branchId" label="Returned to" required>
            {/* Goods can come back to any branch, not only where they were sold. */}
            <AppSelect
              id="branchId"
              label="Returned to"
              value={branchId}
              onValueChange={setBranchId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </Field>

          <Field id="reason" label="Reason">
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Faulty, changed their mind…"
            />
          </Field>

          {canRefund ? (
            <>
              <Field id="refundMethod" label="Refund">
                <AppSelect
                  id="refundMethod"
                  label="Refund"
                  value={refundMethod}
                  onValueChange={setRefundMethod}
                  options={[
                    { value: 'PAYMENT_METHOD', label: 'Pay the money back' },
                    { value: 'CUSTOMER_ACCOUNT', label: 'Credit their account' },
                    { value: 'NONE', label: 'No refund now' },
                  ]}
                />
              </Field>

              {refundMethod === 'PAYMENT_METHOD' ? (
                <Field id="methodId" label="Paid back by">
                  <AppSelect
                    id="methodId"
                    label="Paid back by"
                    value={methodId}
                    onValueChange={setMethodId}
                    options={methods.map((m) => ({ value: String(m.id), label: m.name }))}
                  />
                </Field>
              ) : null}

              <Field id="deduction" label="Deduction (₹)" hint="A restocking fee, if any">
                <Input
                  id="deduction"
                  inputMode="decimal"
                  value={deduction}
                  onChange={(e) => setDeduction(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <dl className="grid gap-0.5 text-sm">
            <div className="flex gap-4">
              <dt className="text-muted-foreground">Goods returned</dt>
              <dd className="tabular font-medium">{formatMoney(goodsValue)}</dd>
            </div>
            {deductionPaise > 0n ? (
              <div className="flex gap-4">
                <dt className="text-muted-foreground">Deduction</dt>
                <dd className="tabular">−{formatMoney(deductionPaise)}</dd>
              </div>
            ) : null}
            <div className="flex gap-4">
              <dt className="text-muted-foreground">
                {refundMethod === 'NONE' ? 'Owed back' : 'Refund'}
              </dt>
              <dd className="tabular font-semibold">{formatMoney(refundable)}</dd>
            </div>
          </dl>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" size="lg" asChild className="flex-1 sm:flex-none">
              <Link href={`/sales/${saleId}`}>Cancel</Link>
            </Button>
            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              disabled={busy || chosen.length === 0}
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : 'Record return'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Returned handsets go to the inspection queue and are not sellable until graded.
        Accessories go straight back into stock.
      </p>
    </div>
  )
}
