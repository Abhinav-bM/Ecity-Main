'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field } from '@/components/form-field'
import { AppSelect } from '@/components/app-select'
import { PartyPicker, type PickedParty } from '@/components/party-picker'
import { ProductPicker, type PickedProduct } from '@/components/product-picker'

type Branch = { id: number; name: string }
type Account = { id: number; name: string; branchName: string | null }

export type OpeningSummary = {
  cashDeclared: number
  accountsDeclared: number
  stockImports: number
  customerDuesDeclared: number
  supplierDuesDeclared: number
}

type StockLine = { key: number; product: PickedProduct | null; quantity: string }
type DueLine = { key: number; party: PickedParty | null; amount: string }

let nextKey = 1

/**
 * Three tabs, one act: declaring what was already there.
 *
 * Typed in here for the handful of figures a shop can count — the till, the
 * bank, the few people who owe a lot. A shop with hundreds of rows sends a
 * file through the import wizard instead, which posts through exactly the
 * same services; the links to it are on each tab rather than buried
 * somewhere else.
 */
export function OpeningBalances({
  branches,
  accounts,
  summary,
  today,
}: {
  branches: Branch[]
  accounts: Account[]
  summary: OpeningSummary
  today: string
}) {
  const router = useRouter()
  const [asOf, setAsOf] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cash, setCash] = useState<Record<number, string>>({})
  const [accountAmounts, setAccountAmounts] = useState<Record<number, string>>({})

  const [stockBranch, setStockBranch] = useState(String(branches[0]?.id ?? ''))
  const [stockLines, setStockLines] = useState<StockLine[]>([
    { key: nextKey++, product: null, quantity: '' },
  ])

  const [customerLines, setCustomerLines] = useState<DueLine[]>([
    { key: nextKey++, party: null, amount: '' },
  ])
  const [supplierLines, setSupplierLines] = useState<DueLine[]>([
    { key: nextKey++, party: null, amount: '' },
  ])

  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/opening-balances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asOf, ...payload }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'That could not be saved.')
        return false
      }
      toast.success(done)
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function saveCash() {
    const branchRows = Object.entries(cash)
      .filter(([, v]) => v.trim() !== '')
      .map(([id, v]) => ({ branchId: Number(id), amount: Number(v) }))
    const accountRows = Object.entries(accountAmounts)
      .filter(([, v]) => v.trim() !== '')
      .map(([id, v]) => ({ accountId: Number(id), amount: Number(v) }))
    if (branchRows.length === 0 && accountRows.length === 0) {
      setError('Enter at least one figure.')
      return
    }
    const ok = await post(
      { kind: 'cash', branches: branchRows, accounts: accountRows },
      'Opening cash recorded.',
    )
    if (ok) {
      setCash({})
      setAccountAmounts({})
    }
  }

  async function saveStock() {
    const lines = stockLines
      .filter((l) => l.product && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity) }))
    if (lines.length === 0) {
      setError('Add a product and how many there are.')
      return
    }
    const ok = await post(
      { kind: 'stock', branchId: Number(stockBranch), lines },
      `Opening stock recorded for ${lines.length} product(s).`,
    )
    if (ok) setStockLines([{ key: nextKey++, product: null, quantity: '' }])
  }

  async function saveDues() {
    const customers = customerLines
      .filter((l) => l.party && l.amount.trim() !== '')
      .map((l) => ({ customerId: l.party!.id, amount: Number(l.amount) }))
    const suppliers = supplierLines
      .filter((l) => l.party && l.amount.trim() !== '')
      .map((l) => ({ supplierId: l.party!.id, amount: Number(l.amount) }))
    if (customers.length === 0 && suppliers.length === 0) {
      setError('Add at least one person and what they owe.')
      return
    }
    const ok = await post({ kind: 'dues', customers, suppliers }, 'Opening dues recorded.')
    if (ok) {
      setCustomerLines([{ key: nextKey++, party: null, amount: '' }])
      setSupplierLines([{ key: nextKey++, party: null, amount: '' }])
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Opening balances</h1>
        <p className="text-sm text-muted-foreground">
          What the shop already had on the day it started using ECITY. These post as movements
          like everything else, so every balance stays provable from what is behind it.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <Field
            id="asOf"
            label="These figures are as at"
            hint="Everything below is dated to this day, not to today."
            required
            className="w-48"
          >
            <Input
              id="asOf"
              type="date"
              value={asOf}
              max={today}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2 text-xs" data-testid="opening-summary">
            <Declared label="Cash" n={summary.cashDeclared} />
            <Declared label="Accounts" n={summary.accountsDeclared} />
            <Declared label="Stock files" n={summary.stockImports} />
            <Declared label="Customer dues" n={summary.customerDuesDeclared} />
            <Declared label="Supplier dues" n={summary.supplierDuesDeclared} />
          </div>
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Tabs defaultValue="cash">
        <TabsList>
          <TabsTrigger value="cash">Cash &amp; accounts</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="dues">Dues</TabsTrigger>
        </TabsList>

        <TabsContent value="cash" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash in hand</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {branches.map((b) => (
                <Field key={b.id} id={`cash-${b.id}`} label={b.name} className="max-w-sm">
                  <Input
                    id={`cash-${b.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cash[b.id] ?? ''}
                    onChange={(e) => setCash((c) => ({ ...c, [b.id]: e.target.value }))}
                  />
                </Field>
              ))}
              <p className="text-xs text-muted-foreground">
                Recorded once per branch. A figure that turns out to be wrong is corrected with a
                cash adjustment, so the original still shows.
              </p>
            </CardContent>
          </Card>

          {accounts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bank, UPI and card accounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {accounts.map((a) => (
                  <Field
                    key={a.id}
                    id={`account-${a.id}`}
                    label={a.branchName ? `${a.name} · ${a.branchName}` : a.name}
                    className="max-w-sm"
                  >
                    <Input
                      id={`account-${a.id}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={accountAmounts[a.id] ?? ''}
                      onChange={(e) =>
                        setAccountAmounts((c) => ({ ...c, [a.id]: e.target.value }))
                      }
                    />
                  </Field>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Button onClick={saveCash} disabled={busy}>
            Record opening cash
          </Button>
        </TabsContent>

        <TabsContent value="stock" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Accessories on the shelf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AppSelect
                id="stock-branch"
                label="At which branch"
                value={stockBranch}
                onValueChange={setStockBranch}
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                className="max-w-sm"
              />

              {stockLines.map((line, i) => (
                <div key={line.key} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[16rem] flex-1">
                    <ProductPicker
                      id={`stock-product-${i}`}
                      label="Product"
                      value={line.product}
                      onSelect={(p) =>
                        setStockLines((rows) =>
                          rows.map((r) => (r.key === line.key ? { ...r, product: p } : r)),
                        )
                      }
                    />
                  </div>
                  <Field id={`stock-qty-${i}`} label="How many" className="w-28">
                    <Input
                      id={`stock-qty-${i}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) =>
                        setStockLines((rows) =>
                          rows.map((r) =>
                            r.key === line.key ? { ...r, quantity: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </Field>
                  {stockLines.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove this line"
                      onClick={() =>
                        setStockLines((rows) => rows.filter((r) => r.key !== line.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setStockLines((rows) => [...rows, { key: nextKey++, product: null, quantity: '' }])
                }
              >
                <Plus className="size-4" /> Another product
              </Button>

              <p className="text-xs text-muted-foreground">
                Handsets are not counted here — each one is its own record with its own IMEI.
                Bring those in as <Link href="/imports?kind=DEVICES" className="underline underline-offset-4">handsets</Link>.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveStock} disabled={busy}>
              Record opening stock
            </Button>
            <Button variant="outline" asChild>
              <Link href="/imports?kind=OPENING_STOCK">
                <Upload className="size-4" /> Import a stock file instead
              </Link>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="dues" className="mt-4 space-y-4">
          <DueCard
            title="What customers already owed"
            kind="customer"
            lines={customerLines}
            setLines={setCustomerLines}
            importHref="/imports?kind=OPENING_CUSTOMER_DUES"
          />
          <DueCard
            title="What the shop already owed suppliers"
            kind="supplier"
            lines={supplierLines}
            setLines={setSupplierLines}
            importHref="/imports?kind=OPENING_SUPPLIER_DUES"
          />
          <Button onClick={saveDues} disabled={busy}>
            Record opening dues
          </Button>
          <p className="text-xs text-muted-foreground">
            These show up wherever a due does — the dues screens, the aging buckets, the credit
            report and the dashboard. A balance nobody can see is worse than not importing it.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Declared({ label, n }: { label: string; n: number }) {
  return (
    <Badge variant={n > 0 ? 'success' : 'secondary'}>
      {label}: {n > 0 ? `${n} declared` : 'not yet'}
    </Badge>
  )
}

function DueCard({
  title,
  kind,
  lines,
  setLines,
  importHref,
}: {
  title: string
  kind: 'customer' | 'supplier'
  lines: DueLine[]
  setLines: React.Dispatch<React.SetStateAction<DueLine[]>>
  importHref: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.map((line, i) => (
          <div key={line.key} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <PartyPicker
                kind={kind}
                id={`${kind}-party-${i}`}
                label={kind === 'customer' ? 'Customer' : 'Supplier'}
                value={line.party}
                onSelect={(p) =>
                  setLines((rows) => rows.map((r) => (r.key === line.key ? { ...r, party: p } : r)))
                }
              />
            </div>
            <Field id={`${kind}-amount-${i}`} label="Amount owed" className="w-36">
              <Input
                id={`${kind}-amount-${i}`}
                inputMode="decimal"
                placeholder="0.00"
                value={line.amount}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((r) => (r.key === line.key ? { ...r, amount: e.target.value } : r)),
                  )
                }
              />
            </Field>
            {lines.length > 1 ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove this line"
                onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((rows) => [...rows, { key: nextKey++, party: null, amount: '' }])}
          >
            <Plus className="size-4" /> Another {kind}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={importHref}>
              <Upload className="size-4" /> Import a file
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
