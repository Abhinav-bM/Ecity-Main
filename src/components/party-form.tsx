'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { partySchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormStateCodeSelect } from '@/components/state-code-select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'

type Values = z.infer<typeof partySchema>

/**
 * Customers and suppliers capture the same information (PRD FR-5.10, FR-6.6),
 * so they share one form. `company` shows only for suppliers.
 */
export function PartyForm({
  kind,
  id,
  initial,
  readOnly = false,
  gstEnabled,
}: {
  kind: 'customer' | 'supplier'
  id?: number
  initial?: Partial<Values>
  /** View-only for a role that can see the record but not change it. */
  readOnly?: boolean
  /** GSTIN and GST state are hidden when the shop is not registered. */
  gstEnabled: boolean
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const plural = `${kind}s`
  const label = kind === 'customer' ? 'Customer' : 'Supplier'

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(partySchema),
    defaultValues: { name: '', ...initial },
  })

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
    const res = await fetch(id ? `/api/${plural}/${id}` : `/api/${plural}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? `Could not save the ${kind}.`)
      return
    }
    toast.success(`${label} ${id ? 'updated' : 'created'}.`)
    router.push(`/${plural}`)
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {id ? `Edit ${kind}` : `Add ${kind}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {label}s are shared across every branch.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        {/* A disabled fieldset blocks every control inside it, so a new field
            cannot accidentally stay editable for a read-only viewer. */}
        <fieldset disabled={readOnly} className="space-y-4">
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" required error={errors.name?.message}>
              <Input id="name" autoFocus {...register('name')} />
            </Field>
            {kind === 'supplier' ? (
              <Field id="company" label="Company" error={errors.company?.message}>
                <Input id="company" {...register('company')} />
              </Field>
            ) : null}
            {gstEnabled ? (
              <>
                <Field
                  id="gstin"
                  label="GST number"
                  error={errors.gstin?.message}
                  hint="15 characters, e.g. 29ABCDE1234F1Z5"
                >
                  <Input id="gstin" className="uppercase" {...register('gstin')} />
                </Field>
                <Field
                  id="stateCode"
                  label="GST state"
                  error={errors.stateCode?.message}
                  hint="Decides CGST/SGST or IGST on their invoices"
                >
                  <FormStateCodeSelect control={control} name="stateCode" id="stateCode" />
                </Field>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              id="phone"
              label="Phone"
              error={errors.phone?.message}
              hint="Used to spot duplicates"
            >
              <Input id="phone" type="tel" inputMode="tel" {...register('phone')} />
            </Field>
            <Field id="altPhone" label="Alternate phone" error={errors.altPhone?.message}>
              <Input id="altPhone" type="tel" inputMode="tel" {...register('altPhone')} />
            </Field>
            <Field id="email" label="Email" error={errors.email?.message} className="sm:col-span-2">
              <Input id="email" type="email" inputMode="email" {...register('email')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="addressLine1" label="Address line 1" className="sm:col-span-2" error={errors.addressLine1?.message}>
              <Input id="addressLine1" {...register('addressLine1')} />
            </Field>
            <Field id="addressLine2" label="Address line 2" className="sm:col-span-2" error={errors.addressLine2?.message}>
              <Input id="addressLine2" {...register('addressLine2')} />
            </Field>
            <Field id="city" label="City" error={errors.city?.message}>
              <Input id="city" {...register('city')} />
            </Field>
            <Field id="state" label="State" error={errors.state?.message}>
              <Input id="state" {...register('state')} />
            </Field>
            <Field id="pincode" label="PIN code" error={errors.pincode?.message}>
              <Input id="pincode" inputMode="numeric" {...register('pincode')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Field id="notes" label="Internal notes" error={errors.notes?.message}>
              <Textarea id="notes" rows={3} {...register('notes')} />
            </Field>
          </CardContent>
        </Card>

        </fieldset>

        {readOnly ? null : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
              <Link href={`/${plural}`}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? 'Saving…' : id ? 'Save changes' : `Create ${kind}`}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
