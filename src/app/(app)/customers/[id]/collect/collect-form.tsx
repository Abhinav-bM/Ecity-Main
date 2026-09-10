'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/form-field'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/app-select'
import { formatMoney } from '@/lib/money'
import { rupeesToPaise } from '@/lib/validation'
import { formatDateShort } from '@/lib/utils'

export type OpenSale = {
  id: number
  invoiceNumber: string
  soldAt: Date | string
  dueDate: Date | string | null
  totalPaise: bigint
  owingPaise: bigint
  branchName: string
}

/**
 * Collecting against one or many open bills (PRD FR-7.3).
 *
 * Typing an amount allocates it oldest-first automatically, which is what a
 * shop does by default; each line can then be overridden by hand for a
 * customer who insists on paying a particular invoice.
 */
export function CollectForm({
  customerId,
  customerName,
  openSales,
  branches,
  methods,
  defaultBranchId,
}: {
  customerId: number
  customerName: string
  openSales: OpenSale[]
  branches: { id: number; code: string; name: string }[]
  methods: { id: number; name: string }[]
  defaultBranchId: number | null
}) {
  const router = useRouter()
  const totalOwing = openSales.reduce((sum, s) => sum + s.owingPaise, 0n)

  const [amount, setAmount] = useState('')
  const [branchId, setBranchId] = useState(String(defaultBranchId ?? branches[0]?.id ?? ''))
  const [methodId, setMethodId] = useState(String(methods[0]?.id ?? ''))
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [manual, setManual] = useState<Record<number, string>>({})
  const [useManual, setUseManual] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const amountPaise = useMemo(
    () => rupeesToPaise(Number(amount) || 0),
    [amount],
  )

  /** Oldest first, exactly as the server would do it. Shown so the salesperson
   *  can see where the money is going before committing. */
  const autoAllocation = useMemo(() => {
    const out = new Map<number, bigint>()
    let left = amountPaise
    for (const s of openSales) {
      if (left <= 0n) break
      const take = s.owingPaise < left ? s.owingPaise : left
      out.set(s.id, take)
      left -= take
    }
    return out
  }, [amountPaise, openSales])

  const manualTotal = useMemo(
    () =>
      Object.values(manual).reduce((sum, v) => sum + rupeesToPaise(Number(v) || 0), 0n),
    [manual],
  )

  const allocated = useManual ? manualTotal : [...autoAllocation.values()].reduce((a, b) => a + b, 0n)
  const advance = amountPaise - allocated

  async function submit() {
    setError(null)
    if (amountPaise <= 0n) {
      setError('Enter how much is being collected.')
      return
    }
    if (useManual && manualTotal > amountPaise) {
      setError('The invoice allocations add up to more than the amount collected.')
      return
    }

    setBusy(true)
    const res = await fetch('/api/customer-payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId,
        branchId: Number(branchId),
        paymentMethodId: Number(methodId),
        amountPaise: amountPaise.toString(),
        reference,
        notes,
        allocations: useManual
          ? Object.entries(manual)
              .filter(([, v]) => v.trim())
              .map(([saleId, v]) => ({
                saleId: Number(saleId),
                amountPaise: rupeesToPaise(Number(v) || 0).toString(),
              }))
          : undefined,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not record the payment.')
      return
    }
    const { id, receiptNumber } = (await res.json()) as { id: number; receiptNumber: string }
    toast.success(`Receipt ${receiptNumber} recorded.`)
    router.push(`/receipts/${id}`)
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Money received</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="amount" label="Amount (₹)" required>
            <Input
              id="amount"
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field id="branchId" label="Collected at" required>
            {/* FR-7.5: a customer can settle at any shop, not only where they bought. */}
            <AppSelect
              id="branchId"
              label="Collected at"
              value={branchId}
              onValueChange={setBranchId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </Field>

          <Field id="methodId" label="Method" required>
            <AppSelect
              id="methodId"
              label="Method"
              value={methodId}
              onValueChange={setMethodId}
              options={methods.map((m) => ({ value: String(m.id), label: m.name }))}
            />
          </Field>

          <Field id="reference" label="Reference">
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UPI ref, cheque number…"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field id="notes" label="Notes">
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setAmount((Number(totalOwing) / 100).toFixed(2))}
            >
              Settle everything ({formatMoney(totalOwing)})
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-sm">
            Open bills for {customerName}
            <span className="ml-2 font-normal text-muted-foreground">
              {openSales.length} · {formatMoney(totalOwing)}
            </span>
          </CardTitle>
          {openSales.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setUseManual((v) => !v)}
            >
              {useManual ? 'Allocate oldest first' : 'Choose invoices'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {openSales.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing outstanding. Anything collected now is held as an advance.
            </p>
          ) : (
            <div className="space-y-2" data-testid="open-bills">
              {openSales.map((s) => {
                const auto = autoAllocation.get(s.id) ?? 0n
                const overdue = s.dueDate ? new Date(s.dueDate).getTime() < Date.now() : false
                return (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/sales/${s.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {s.invoiceNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateShort(s.soldAt)} · {s.branchName}
                        {s.dueDate ? (
                          <span className={overdue ? 'text-destructive' : ''}>
                            {' '}
                            · due {formatDateShort(s.dueDate)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular text-muted-foreground">
                        {formatMoney(s.owingPaise)} owing
                      </span>
                      {useManual ? (
                        <Input
                          className="h-8 w-28 text-right"
                          inputMode="decimal"
                          aria-label={`Allocate to ${s.invoiceNumber}`}
                          value={manual[s.id] ?? ''}
                          onChange={(e) =>
                            setManual((m) => ({ ...m, [s.id]: e.target.value }))
                          }
                          placeholder="0.00"
                        />
                      ) : (
                        <span
                          className={`tabular w-28 text-right font-medium ${auto > 0n ? '' : 'text-muted-foreground'}`}
                        >
                          {auto > 0n ? formatMoney(auto) : '—'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <dl className="grid gap-0.5 text-sm">
            <div className="flex gap-4">
              <dt className="text-muted-foreground">Collecting</dt>
              <dd className="tabular font-medium">{formatMoney(amountPaise)}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-muted-foreground">Allocated</dt>
              <dd className="tabular">{formatMoney(allocated)}</dd>
            </div>
            {advance > 0n ? (
              <div className="flex gap-4">
                <dt className="text-muted-foreground">Held as advance</dt>
                <dd className="tabular">{formatMoney(advance)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" size="lg" asChild className="flex-1 sm:flex-none">
              <Link href={`/customers/${customerId}`}>Cancel</Link>
            </Button>
            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              disabled={busy || amountPaise <= 0n}
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
