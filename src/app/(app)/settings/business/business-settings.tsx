'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { businessProfileSchema, toPercent } from '@/lib/validation'
import type {
  Business,
  ExpenseCategory,
  PaymentMethod,
  TaxRate,
} from '@/server/db/schema'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field } from '@/components/form-field'

type ProfileValues = z.infer<typeof businessProfileSchema>

export function BusinessSettings({
  business,
  taxRates,
  paymentMethods,
  expenseCategories,
  canManage,
}: {
  business: Business
  taxRates: TaxRate[]
  paymentMethods: PaymentMethod[]
  expenseCategories: ExpenseCategory[]
  canManage: boolean
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Business settings</h1>
        <p className="text-sm text-muted-foreground">
          These drive the pickers and totals used by billing, purchases and expenses.
        </p>
      </div>

      <Tabs defaultValue="profile">
        {/* Scrolls rather than wraps on a phone. */}
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileForm business={business} canManage={canManage} />
        </TabsContent>
        <TabsContent value="tax" className="mt-4">
          <TaxRates rates={taxRates} canManage={canManage} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentMethods methods={paymentMethods} canManage={canManage} />
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          <ExpenseCategories categories={expenseCategories} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ProfileForm({ business, canManage }: { business: Business; canManage: boolean }) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [includeTax, setIncludeTax] = useState(business.pricesIncludeTax)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: {
      name: business.name,
      legalName: business.legalName ?? '',
      email: business.email ?? '',
      phone: business.phone ?? '',
      addressLine1: business.addressLine1 ?? '',
      addressLine2: business.addressLine2 ?? '',
      city: business.city ?? '',
      state: business.state ?? '',
      pincode: business.pincode ?? '',
      gstin: business.gstin ?? '',
      currency: business.currency,
      timezone: business.timezone,
      pricesIncludeTax: business.pricesIncludeTax,
      invoicePrefix: business.invoicePrefix,
    },
  })

  async function onSubmit(values: ProfileValues) {
    setFormError(null)
    const res = await fetch('/api/business', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, pricesIncludeTax: includeTax }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not save.')
      return
    }
    toast.success('Business profile saved.')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive">{formError}</Alert> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Profile</CardTitle>
          <CardDescription>Appears on every invoice and receipt.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Business name" required error={errors.name?.message}>
            <Input id="name" disabled={!canManage} {...register('name')} />
          </Field>
          <Field id="legalName" label="Legal name" error={errors.legalName?.message}>
            <Input id="legalName" disabled={!canManage} {...register('legalName')} />
          </Field>
          <Field id="phone" label="Phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" disabled={!canManage} {...register('phone')} />
          </Field>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input id="email" type="email" disabled={!canManage} {...register('email')} />
          </Field>
          <Field id="gstin" label="GST number" error={errors.gstin?.message}>
            <Input id="gstin" className="uppercase" disabled={!canManage} {...register('gstin')} />
          </Field>
          <Field id="invoicePrefix" label="Invoice prefix" error={errors.invoicePrefix?.message}>
            <Input
              id="invoicePrefix"
              className="uppercase"
              disabled={!canManage}
              {...register('invoicePrefix')}
            />
          </Field>
          <Field id="addressLine1" label="Address" className="sm:col-span-2" error={errors.addressLine1?.message}>
            <Input id="addressLine1" disabled={!canManage} {...register('addressLine1')} />
          </Field>
          <Field id="city" label="City" error={errors.city?.message}>
            <Input id="city" disabled={!canManage} {...register('city')} />
          </Field>
          <Field id="state" label="State" error={errors.state?.message}>
            <Input id="state" disabled={!canManage} {...register('state')} />
          </Field>
          <Field id="currency" label="Currency" hint="Single currency per business">
            <Input id="currency" disabled className="uppercase" {...register('currency')} />
          </Field>
          <Field id="timezone" label="Timezone" error={errors.timezone?.message}>
            <Input id="timezone" disabled={!canManage} {...register('timezone')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pricing</CardTitle>
          <CardDescription>
            This changes every total in the system, so it is set once for the whole business.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Switch
              id="pricesIncludeTax"
              checked={includeTax}
              onCheckedChange={setIncludeTax}
              disabled={!canManage}
            />
            <div className="space-y-0.5">
              <Label htmlFor="pricesIncludeTax">Prices include tax</Label>
              <p className="text-xs text-muted-foreground">
                {includeTax
                  ? 'The price typed on a bill already contains tax; the tax component is derived from it.'
                  : 'Tax is added on top of the price typed on a bill.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

function TaxRates({ rates, canManage }: { rates: TaxRate[]; canManage: boolean }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [percent, setPercent] = useState('')
  const [pending, startTransition] = useTransition()

  async function add() {
    const res = await fetch('/api/business/tax-rates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, ratePercent: percent, isDefault: false }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not add the tax rate.')
      return
    }
    setName('')
    setPercent('')
    toast.success('Tax rate added.')
    startTransition(() => router.refresh())
  }

  async function setActive(rate: TaxRate, isActive: boolean) {
    const res = await fetch(`/api/business/tax-rates/${rate.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not update.')
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Tax rates</CardTitle>
        <CardDescription>
          Stored as exact integers, never decimals — a rate multiplies money.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-md border">
          {rates.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="tabular font-mono text-sm">
                {toPercent(r.rateBasisPoints).toFixed(2)}%
              </span>
              {r.isDefault ? <Badge>Default</Badge> : null}
              {!r.isActive ? <Badge variant="muted">Inactive</Badge> : null}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void setActive(r, !r.isActive)}
                >
                  {r.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 sm:max-w-xs"
              placeholder="Name, e.g. GST 18%"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Tax rate name"
            />
            <Input
              className="w-28"
              placeholder="18"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-label="Tax rate percent"
            />
            <Button onClick={() => void add()} disabled={!name || !percent || pending}>
              Add rate
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PaymentMethods({
  methods,
  canManage,
}: {
  methods: PaymentMethod[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function setActive(m: PaymentMethod, isActive: boolean) {
    const res = await fetch(`/api/business/payment-methods/${m.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not update.')
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Payment methods</CardTitle>
        <CardDescription>
          Cash methods post to the branch drawer; the rest post to accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {methods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {m.type}
              </Badge>
              {m.affectsCashDrawer ? <Badge variant="muted">Cash drawer</Badge> : null}
              {!m.isActive ? <Badge variant="muted">Inactive</Badge> : null}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void setActive(m, !m.isActive)}
                >
                  {m.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ExpenseCategories({
  categories,
  canManage,
}: {
  categories: ExpenseCategory[]
  canManage: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, startTransition] = useTransition()

  async function add() {
    const res = await fetch('/api/business/expense-categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      toast.error(data.error ?? 'Could not add the category.')
      return
    }
    setName('')
    toast.success('Category added.')
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Expense categories</CardTitle>
        <CardDescription>Used when recording expenses in M7.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Badge key={c.id} variant={c.isActive ? 'secondary' : 'muted'}>
              {c.name}
            </Badge>
          ))}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 sm:max-w-xs"
              placeholder="New category"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Expense category name"
            />
            <Button onClick={() => void add()} disabled={!name || pending}>
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
