'use client'

import { useState } from 'react'
import { trackingDescription, trackingLabel, type Tracking } from '@/lib/tracking'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { productSchema } from '@/lib/validation'
import { FormError } from '@/components/form-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'
import { FormSelect } from '@/components/app-select'

type Values = z.infer<typeof productSchema>

export function ProductForm({
  id,
  initial,
  categories,
  brands,
  taxRates,
  suppliers,
  gstEnabled,
}: {
  id?: number
  initial?: Partial<Values>
  categories: ({ id: number; name: string } & Tracking)[]
  brands: { id: number; name: string }[]
  taxRates: { id: number; name: string }[]
  suppliers: { id: number; name: string }[]
  /** HSN and tax rate are GST concepts; hidden when the shop is not registered. */
  gstEnabled: boolean
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: '', ...initial },
  })

  const categoryId = Number(watch('categoryId'))
  const chosen = categories.find((c) => c.id === categoryId)

  /**
   * A rejected form must say why, never just do nothing. The specific
   * message lives on the field; this only says that something is wrong,
   * so the two do not duplicate each other.
   */
  function onInvalid() {
    setFormError('Please check the highlighted fields.')
  }

  async function onSubmit(values: Values) {
    setFormError(null)
    const res = await fetch(id ? `/api/products/${id}` : '/api/products', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not save the product.')
      return
    }
    toast.success(`Product ${id ? 'updated' : 'created'}.`)
    router.push('/products')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {id ? 'Edit product' : 'Add product'}
        </h1>
        <p className="text-sm text-muted-foreground">
          A product is the catalogue entry. For mobiles it is the model; each handset is a separate
          device.
          {id ? null : ' Save it first, then add an image.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Details</CardTitle>
            {chosen ? (
              <CardDescription className="flex items-center gap-2">
                {chosen.isSerialised ? (
                  <>
                    <Badge variant="outline">{trackingLabel(chosen)}</Badge>
                    {trackingDescription(chosen)}
                  </>
                ) : (
                  <>
                    <Badge variant="secondary">Quantity-tracked</Badge>
                    Counted per branch.
                  </>
                )}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Product name" required error={errors.name?.message}>
              <Input id="name" autoFocus {...register('name')} />
            </Field>
            <Field id="categoryId" label="Category" required error={errors.categoryId?.message}>
              <FormSelect
                control={control}
                name="categoryId"
                id="categoryId"
                label="Category"
                placeholder="Choose a category…"
                options={categories.map((c) => ({
                  value: String(c.id),
                  // The identifier type is part of the label: a shop needs to
                  // see that "Mobiles" means IMEI-tracked before choosing it.
                  label: `${c.name}${c.isSerialised ? ` (${trackingLabel(c)})` : ''}`,
                }))}
              />
            </Field>
            <Field id="brandId" label="Brand" error={errors.brandId?.message}>
              <FormSelect
                control={control}
                name="brandId"
                id="brandId"
                label="Brand"
                allowEmpty
                emptyLabel="No brand"
                placeholder="No brand"
                options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
              />
            </Field>
            <Field id="model" label="Model" error={errors.model?.message}>
              <Input id="model" {...register('model')} />
            </Field>
            <Field id="sku" label="SKU" error={errors.sku?.message} hint="Unique across the business">
              <Input id="sku" className="uppercase" {...register('sku')} />
            </Field>
            {gstEnabled ? (
              <Field
                id="hsnCode"
                label="HSN code"
                error={errors.hsnCode?.message}
                hint="Printed on every tax invoice. 8517 for phones, 8544 for cables."
              >
                <Input id="hsnCode" inputMode="numeric" {...register('hsnCode')} />
              </Field>
            ) : null}

            <Field id="barcode" label="Barcode" error={errors.barcode?.message}>
              <Input id="barcode" {...register('barcode')} />
            </Field>
            <Field
              id="description"
              label="Description"
              error={errors.description?.message}
              className="sm:col-span-2"
            >
              <Textarea id="description" rows={2} {...register('description')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Default pricing</CardTitle>
            <CardDescription>
              Starting values for data entry. What a device actually cost or sold for is recorded on
              the device and the bill.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="purchasePrice" label="Purchase price (₹)" error={errors.purchasePrice?.message}>
              <Input id="purchasePrice" inputMode="decimal" {...register('purchasePrice')} />
            </Field>
            <Field id="sellingPrice" label="Selling price (₹)" error={errors.sellingPrice?.message}>
              <Input id="sellingPrice" inputMode="decimal" {...register('sellingPrice')} />
            </Field>
            {gstEnabled ? (
              <Field id="taxRateId" label="Tax rate" error={errors.taxRateId?.message}>
                <FormSelect
                  control={control}
                  name="taxRateId"
                  id="taxRateId"
                  label="Tax rate"
                  allowEmpty
                  emptyLabel="No tax rate"
                  placeholder="No tax rate"
                  options={taxRates.map((t) => ({ value: String(t.id), label: t.name }))}
                />
              </Field>
            ) : null}
            <Field
              id="defaultSupplierId"
              label="Usual supplier"
              error={errors.defaultSupplierId?.message}
            >
              <FormSelect
                control={control}
                name="defaultSupplierId"
                id="defaultSupplierId"
                label="Default supplier"
                allowEmpty
                emptyLabel="None"
                placeholder="None"
                options={suppliers.map((x) => ({ value: String(x.id), label: x.name }))}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/products">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : id ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </div>
  )
}
