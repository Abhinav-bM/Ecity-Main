'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { MAIN_TYPES, deviceSchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'

type Values = z.infer<typeof deviceSchema>

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function DeviceForm({
  imeiSlots,
  products,
  suppliers,
  branches,
  taxRates,
  defaultBranchId,
}: {
  imeiSlots: number
  products: { id: number; name: string }[]
  suppliers: { id: number; name: string }[]
  branches: { id: number; code: string; name: string }[]
  taxRates: { id: number; name: string }[]
  defaultBranchId: number | null
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [mainType, setMainType] = useState<(typeof MAIN_TYPES)[number]>('NEW')
  const [isNewCut, setIsNewCut] = useState(false)
  // One input per configured slot. The payload is a list regardless.
  const [imeis, setImeis] = useState<string[]>(Array.from({ length: imeiSlots }, () => ''))

  /**
   * The IMEI inputs are local state (their number is driven by `imeiSlots`),
   * but the resolver validates the form's own values. Without this the
   * resolver would always see an empty list and silently block submission.
   */
  function updateImei(index: number, value: string) {
    const next = [...imeis]
    next[index] = value
    setImeis(next)
    setValue(
      'imeis',
      next.map((v) => v.trim()).filter(Boolean),
      { shouldValidate: false },
    )
  }

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(deviceSchema),
    defaultValues: {
      imeis: [],
      mainType: 'NEW',
      isNewCut: false,
      branchId: defaultBranchId ?? undefined,
    },
  })

  /**
   * Guard against the whole class of "the button does nothing" bugs. The
   * specific reason is shown on the field; this only says something is wrong.
   */
  function onInvalid() {
    setFormError('Please check the highlighted fields.')
  }

  async function onSubmit(values: Values) {
    setFormError(null)
    const payload = {
      ...values,
      mainType,
      isNewCut,
      imeis: imeis.map((i) => i.trim()).filter(Boolean),
    }
    if (payload.imeis.length === 0) {
      setFormError('Enter at least one IMEI.')
      return
    }

    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not register the device.')
      return
    }
    toast.success('Device registered.')
    router.push('/devices')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Register device</h1>
        <p className="text-sm text-muted-foreground">
          For opening stock and corrections. Most devices arrive through a purchase.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Identity</CardTitle>
            <CardDescription>
              {imeiSlots === 1
                ? 'A device may hold more than one IMEI. Additional slots are enabled in business settings.'
                : `Up to ${imeiSlots} IMEIs, one per SIM slot.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {imeis.map((value, i) => (
              <Field
                key={i}
                id={`imei-${i}`}
                label={imeiSlots === 1 ? 'IMEI' : `IMEI ${i + 1}`}
                required={i === 0}
                error={i === 0 ? errors.imeis?.message : undefined}
                hint={i === 0 ? '14 to 17 digits — scan or type' : undefined}
              >
                <Input
                  id={`imei-${i}`}
                  inputMode="numeric"
                  autoFocus={i === 0}
                  className="font-mono"
                  value={value}
                  onChange={(e) => updateImei(i, e.target.value)}
                />
              </Field>
            ))}

            <Field id="productId" label="Product" required error={errors.productId?.message}>
              <select id="productId" className={selectClass} {...register('productId')}>
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="branchId" label="Branch" required error={errors.branchId?.message}>
              <select id="branchId" className={selectClass} {...register('branchId')}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Classification</CardTitle>
            <CardDescription>
              NEW CUT is a designation inside GLOBAL — never a separate type.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Main type *</Label>
              <div className="flex flex-wrap gap-2">
                {MAIN_TYPES.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={mainType === t ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setMainType(t)
                      if (t !== 'GLOBAL') setIsNewCut(false)
                    }}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            {/* Only offered for GLOBAL — the rule made visible, not just enforced. */}
            {mainType === 'GLOBAL' ? (
              <div className="space-y-3 rounded-md border p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={isNewCut}
                    onCheckedChange={(c) => setIsNewCut(c === true)}
                    aria-label="NEW CUT"
                  />
                  This GLOBAL device is <strong>NEW CUT</strong>
                </label>
                {isNewCut ? (
                  <Field id="newCutNotes" label="NEW CUT details" error={errors.newCutNotes?.message}>
                    <Textarea id="newCutNotes" rows={2} {...register('newCutNotes')} />
                  </Field>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                NEW CUT applies only to GLOBAL devices.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Specification and price</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="variant" label="Variant" error={errors.variant?.message}>
              <Input id="variant" {...register('variant')} />
            </Field>
            <Field id="colour" label="Colour" error={errors.colour?.message}>
              <Input id="colour" {...register('colour')} />
            </Field>
            <Field id="ram" label="RAM" error={errors.ram?.message}>
              <Input id="ram" placeholder="8 GB" {...register('ram')} />
            </Field>
            <Field id="storage" label="Storage" error={errors.storage?.message}>
              <Input id="storage" placeholder="128 GB" {...register('storage')} />
            </Field>
            <Field id="purchasePrice" label="Purchase price (₹)" error={errors.purchasePrice?.message}>
              <Input id="purchasePrice" inputMode="decimal" {...register('purchasePrice')} />
            </Field>
            <Field id="sellingPrice" label="Selling price (₹)" error={errors.sellingPrice?.message}>
              <Input id="sellingPrice" inputMode="decimal" {...register('sellingPrice')} />
            </Field>
            <Field id="taxRateId" label="Tax rate" error={errors.taxRateId?.message}>
              <select id="taxRateId" className={selectClass} {...register('taxRateId')}>
                <option value="">Use the product default</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="supplierId" label="Supplier" error={errors.supplierId?.message}>
              <select id="supplierId" className={selectClass} {...register('supplierId')}>
                <option value="">Not recorded</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="purchaseDate" label="Purchase date" error={errors.purchaseDate?.message}>
              <Input id="purchaseDate" type="date" {...register('purchaseDate')} />
            </Field>
            <Field
              id="warrantyMonths"
              label="Warranty (months)"
              error={errors.warrantyMonths?.message}
            >
              <Input id="warrantyMonths" inputMode="numeric" {...register('warrantyMonths')} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/devices">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : 'Register device'}
          </Button>
        </div>
      </form>
    </div>
  )
}
