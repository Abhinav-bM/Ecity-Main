'use client'

import { useMemo, useState } from 'react'
import { shopDateString } from '@/lib/date'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AppSelect } from '@/components/app-select'

/** PRD FR-10.2. Everything an expense needs, and nothing it does not. */
export function ExpenseForm({
  categories,
  paymentMethods,
  accounts,
  branches,
  defaultBranchId,
  canCorrectClosedDays,
}: {
  categories: { id: number; name: string }[]
  paymentMethods: { id: number; name: string; affectsCashDrawer: boolean }[]
  accounts: { id: number; name: string }[]
  branches: { id: number; name: string }[]
  defaultBranchId: number | null
  /** Backdating into a closed day is a correction, and needs authorisation. */
  canCorrectClosedDays: boolean
}) {
  const router = useRouter()
  // The shop's today, not the browser's - they differ overnight in India.
  const today = shopDateString()

  const [branchId, setBranchId] = useState(String(defaultBranchId ?? ''))
  const [categoryId, setCategoryId] = useState(String(categories[0]?.id ?? ''))
  const [methodId, setMethodId] = useState(String(paymentMethods[0]?.id ?? ''))
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [businessDate, setBusinessDate] = useState(today)
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A cash expense comes out of the till; anything else out of an account, so
  // the account picker only makes sense for the second kind.
  const isCash = useMemo(
    () => paymentMethods.find((m) => String(m.id) === methodId)?.affectsCashDrawer ?? false,
    [methodId, paymentMethods],
  )

  async function submit() {
    setError(null)
    if (!branchId) return setError('Choose the branch this expense belongs to.')
    if (!categoryId) return setError('Choose a category.')
    if (!methodId) return setError('Choose how it was paid.')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount.')

    setBusy(true)
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branchId: Number(branchId),
        categoryId: Number(categoryId),
        paymentMethodId: Number(methodId),
        accountId: !isCash && accountId ? Number(accountId) : null,
        amount: value,
        businessDate,
        description,
        reference,
      }),
    })
    setBusy(false)

    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setError(data.error ?? 'Could not record it.')
      return
    }
    toast.success('Expense recorded.')
    router.push('/expenses')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Record an expense</h1>
        <p className="text-sm text-muted-foreground">
          This takes the money out of the branch drawer or the account, straight away.
        </p>
      </div>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">The expense</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="branchId">Branch</Label>
            <AppSelect
              id="branchId"
              label="Branch"
              value={branchId}
              onValueChange={setBranchId}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="categoryId">Category</Label>
            <AppSelect
              id="categoryId"
              label="Category"
              value={categoryId}
              onValueChange={setCategoryId}
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="businessDate">Date</Label>
            <Input
              id="businessDate"
              type="date"
              max={today}
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
            />
            {businessDate < today && !canCorrectClosedDays ? (
              <p className="text-xs text-muted-foreground">
                A day that has already been closed will be refused — ask a manager.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="methodId">Paid by</Label>
            <AppSelect
              id="methodId"
              label="Paid by"
              value={methodId}
              onValueChange={setMethodId}
              options={paymentMethods.map((m) => ({ value: String(m.id), label: m.name }))}
            />
          </div>
          {!isCash ? (
            <div className="space-y-1.5">
              <Label htmlFor="accountId">From account</Label>
              <AppSelect
                id="accountId"
                label="From account"
                allowEmpty
                emptyLabel="Not tracked"
                placeholder="Not tracked"
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              />
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/expenses')}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Record expense'}
        </Button>
      </div>
    </div>
  )
}
