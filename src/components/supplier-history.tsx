'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatDateShort } from '@/lib/utils'
import { formatMoney } from '@/lib/money'

const PAY_VARIANT = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'muted' } as const

export type HistoryPurchase = {
  id: number
  purchaseNumber: string
  purchaseDate: Date | string
  status: string
  totalPaise: bigint
  paidPaise: bigint
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
}

export type HistoryPayment = {
  id: number
  amountPaise: bigint
  paidOn: Date | string
  reference: string | null
  voidedAt: Date | string | null
  voidReason: string | null
}

/**
 * The supplier profile's history tab (PRD FR-5.11, FR-14.1) — purchases,
 * payments and the running balance in one place.
 */
export function SupplierHistory({
  supplierId,
  supplierName,
  branchId,
  balancePaise,
  purchases,
  payments,
  paymentMethods,
  canPay,
}: {
  supplierId: number
  supplierName: string
  branchId: number | null
  balancePaise: bigint
  purchases: HistoryPurchase[]
  payments: HistoryPayment[]
  paymentMethods: { id: number; name: string }[]
  canPay: boolean
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-sm">Account</CardTitle>
            <CardDescription>
              The balance is the sum of every ledger entry, not a stored number.
            </CardDescription>
          </div>
          {canPay && branchId ? (
            <PayDialog
              supplierId={supplierId}
              supplierName={supplierName}
              branchId={branchId}
              paymentMethods={paymentMethods}
              suggested={balancePaise > 0n ? Number(balancePaise) / 100 : 0}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="tabular text-2xl font-semibold">{formatMoney(balancePaise)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Purchases</CardTitle>
        </CardHeader>
        <CardContent>
          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases from this supplier yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {purchases.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Link
                    href={`/purchases/${p.id}`}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    {p.purchaseNumber}
                  </Link>
                  <span className="text-muted-foreground">{formatDateShort(p.purchaseDate)}</span>
                  <span className="tabular ml-auto">{formatMoney(p.totalPaise)}</span>
                  {p.status === 'REVERSED' ? (
                    <Badge variant="destructive">Reversed</Badge>
                  ) : (
                    <Badge variant={PAY_VARIANT[p.paymentStatus]}>{p.paymentStatus}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing paid yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="text-muted-foreground">{formatDateShort(p.paidOn)}</span>
                  {p.reference ? <span className="font-mono text-xs">{p.reference}</span> : null}
                  <span
                    className={`tabular ml-auto ${p.voidedAt ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {formatMoney(p.amountPaise)}
                  </span>
                  {p.voidedAt ? <Badge variant="destructive">Voided</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PayDialog({
  supplierId,
  supplierName,
  branchId,
  paymentMethods,
  suggested,
}: {
  supplierId: number
  supplierName: string
  branchId: number
  paymentMethods: { id: number; name: string }[]
  suggested: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(suggested ? String(suggested) : '')
  const [methodId, setMethodId] = useState(String(paymentMethods[0]?.id ?? ''))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pay() {
    setError(null)
    setBusy(true)
    const res = await fetch('/api/supplier-payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No allocations: the server settles the oldest purchases first, which
      // is how a shop normally clears a supplier.
      body: JSON.stringify({
        supplierId,
        branchId,
        paymentMethodId: methodId,
        amount,
        reference,
        allocations: [],
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not record the payment.')
      return
    }
    toast.success('Payment recorded.')
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {supplierName}</DialogTitle>
          <DialogDescription>
            Settles the oldest unpaid purchases first. Anything beyond what is owed stays on the
            account as an advance.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Payment method</Label>
            <AppSelect
              id="pay-method"
              label="Payment method"
              value={methodId}
              onValueChange={setMethodId}
              options={paymentMethods.map((m) => ({ value: String(m.id), label: m.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-reference">Reference</Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UPI ref, cheque number…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !amount || Number(amount) <= 0} onClick={() => void pay()}>
            {busy ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
