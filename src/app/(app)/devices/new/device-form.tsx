'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ProductPicker, type PickedProduct } from '@/components/product-picker'
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
import { FormSelect } from '@/components/app-select'

type Values = z.infer<typeof deviceSchema>

export function DeviceForm({
  imeiSlots,
  hasProducts,
  suppliers,
  branches,
  taxRates,
  defaultBranchId,
}: {
  imeiSlots: number
  /** Each product carries its category's identifier type, so the form can
   *  label the field "IMEI" for a phone and "Serial number" for a laptop. */
  hasProducts: boolean
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
  const [identifiers, setIdentifiers] = useState<string[]>(
    Array.from({ length: imeiSlots }, () => ''),
  )

  /**
   * The IMEI inputs are local state (their number is driven by `imeiSlots`),
   * but the resolver validates the form's own values. Without this the
   * resolver would always see an empty list and silently block submission.
   */
  function updateIdentifier(index: number, value: string) {
    const next = [...identifiers]
    next[index] = value
    setIdentifiers(next)
    setValue(
      'identifiers',
      next.map((v) => v.trim()).filter(Boolean),
      { shouldValidate: false },
    )
  }

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(deviceSchema),
    defaultValues: {
      identifiers: [],
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

  // A phone is identified by IMEI, a laptop or speaker by a serial number.
  // The classification below is identical for both.
  const [picked, setPicked] = useState<PickedProduct | null>(null)
  const chosenProduct = picked
  const identifierLabel = chosenProduct?.identifierType === 'SERIAL' ? 'Serial number' : 'IMEI'
  const isSerial = chosenProduct?.identifierType === 'SERIAL'

  async function onSubmit(values: Values) {
    setFormError(null)
    const payload = {
      ...values,
      mainType,
      isNewCut,
      identifiers: identifiers.map((i) => i.trim()).filter(Boolean),
    }
    if (payload.identifiers.length === 0) {
      setFormError(`Enter at least one ${identifierLabel.toLowerCase()}.`)
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

  // Nothing can be registered against a catalogue that has no serialised
  // products, so say so rather than showing an empty dropdown.
  if (!hasProducts) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Add a device manually
        </h1>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm font-medium">No products to register a device against yet.</p>
            <p className="text-sm text-muted-foreground">
              A device is one physical unit of a product — an iPhone 16 128GB, a MacBook Air.
              Create the product first, then register its units here.
            </p>
            <Button asChild size="sm">
              <Link href="/products/new">Add a product</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Add a device manually
        </h1>
        <p className="text-sm text-muted-foreground">
          This is the manual path, for opening stock and corrections. Stock arriving from a
          supplier should be entered as a <strong>purchase</strong> instead — that records the
          supplier, cost and date once for the whole delivery, and captures every identifier in
          one grid.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Identity</CardTitle>
            <CardDescription>
              {isSerial
                ? 'Laptops, speakers and other electronics are identified by their manufacturer serial number.'
                : imeiSlots === 1
                  ? 'A phone may hold more than one IMEI. Additional slots are enabled in business settings.'
                  : `Up to ${imeiSlots} IMEIs, one per SIM slot.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {identifiers.map((value, i) => (
              <Field
                key={i}
                id={`identifier-${i}`}
                label={imeiSlots === 1 || isSerial ? identifierLabel : `${identifierLabel} ${i + 1}`}
                required={i === 0}
                error={i === 0 ? errors.identifiers?.message : undefined}
                hint={
                  i === 0
                    ? isSerial
                      ? 'The manufacturer serial — scan or type'
                      : '14 to 17 digits — scan or type'
                    : undefined
                }
              >
                <Input
                  id={`identifier-${i}`}
                  inputMode={isSerial ? 'text' : 'numeric'}
                  autoFocus={i === 0}
                  className="font-mono"
                  value={value}
                  onChange={(e) => updateIdentifier(i, e.target.value)}
                />
              </Field>
            ))}

            <Field id="productId" label="Product" required error={errors.productId?.message}>
              {/*
                A plain dropdown would have to be capped, and a shop with hundreds of
                serialised products would find the ones past the cap simply
                missing. Same searchable picker the purchase form uses.
              */}
              <ProductPicker
                id="productId"
                serialisedOnly
                value={picked}
                onSelect={(p) => {
                  setPicked(p)
                  setValue('productId', p.id, { shouldValidate: true })
                }}
              />
            </Field>

            <Field id="branchId" label="Branch" required error={errors.branchId?.message}>
              <FormSelect
                control={control}
                name="branchId"
                id="branchId"
                label="Branch"
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              />
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
            <Field
              id="batteryHealth"
              label="Battery health (%)"
              error={errors.batteryHealth?.message}
              hint="Leave blank for sealed new stock"
            >
              <Input
                id="batteryHealth"
                inputMode="numeric"
                placeholder="87"
                {...register('batteryHealth')}
              />
            </Field>
            <Field id="purchasePrice" label="Purchase price (₹)" error={errors.purchasePrice?.message}>
              <Input id="purchasePrice" inputMode="decimal" {...register('purchasePrice')} />
            </Field>
            <Field id="sellingPrice" label="Selling price (₹)" error={errors.sellingPrice?.message}>
              <Input id="sellingPrice" inputMode="decimal" {...register('sellingPrice')} />
            </Field>
            <Field id="taxRateId" label="Tax rate" error={errors.taxRateId?.message}>
              <FormSelect
                control={control}
                name="taxRateId"
                id="taxRateId"
                label="Tax rate"
                allowEmpty
                emptyLabel="Use the product default"
                placeholder="Use the product default"
                options={taxRates.map((t) => ({ value: String(t.id), label: t.name }))}
              />
            </Field>
            <Field id="supplierId" label="Supplier" error={errors.supplierId?.message}>
              <FormSelect
                control={control}
                name="supplierId"
                id="supplierId"
                label="Supplier"
                allowEmpty
                emptyLabel="Not recorded"
                placeholder="Not recorded"
                options={suppliers.map((x) => ({ value: String(x.id), label: x.name }))}
              />
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
            {isSubmitting ? 'Saving…' : 'Add device'}
          </Button>
        </div>
      </form>
    </div>
  )
}
