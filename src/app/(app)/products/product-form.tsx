'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { productSchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'

type Values = z.infer<typeof productSchema>

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function ProductForm({
  id,
  initial,
  categories,
  brands,
  taxRates,
  suppliers,
}: {
  id?: number
  initial?: Partial<Values>
  categories: { id: number; name: string; isSerialised: boolean }[]
  brands: { id: number; name: string }[]
  taxRates: { id: number; name: string }[]
  suppliers: { id: number; name: string }[]
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
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
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Details</CardTitle>
            {chosen ? (
              <CardDescription className="flex items-center gap-2">
                {chosen.isSerialised ? (
                  <>
                    <Badge variant="outline">IMEI-tracked</Badge>
                    Each unit is registered individually as a device.
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
              <select id="categoryId" className={selectClass} {...register('categoryId')}>
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isSerialised ? ' (IMEI)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="brandId" label="Brand" error={errors.brandId?.message}>
              <select id="brandId" className={selectClass} {...register('brandId')}>
                <option value="">No brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="model" label="Model" error={errors.model?.message}>
              <Input id="model" {...register('model')} />
            </Field>
            <Field id="sku" label="SKU" error={errors.sku?.message} hint="Unique across the business">
              <Input id="sku" className="uppercase" {...register('sku')} />
            </Field>
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
            <Field id="taxRateId" label="Tax rate" error={errors.taxRateId?.message}>
              <select id="taxRateId" className={selectClass} {...register('taxRateId')}>
                <option value="">No tax rate</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="defaultSupplierId"
              label="Usual supplier"
              error={errors.defaultSupplierId?.message}
            >
              <select
                id="defaultSupplierId"
                className={selectClass}
                {...register('defaultSupplierId')}
              >
                <option value="">Not set</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
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
