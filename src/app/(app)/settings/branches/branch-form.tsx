'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { branchSchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormStateCodeSelect } from '@/components/state-code-select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form-field'
import { FormSelect } from '@/components/app-select'

type Values = z.infer<typeof branchSchema>

export function BranchForm({
  id,
  initial,
  managers,
}: {
  id?: number
  initial?: Partial<Values>
  managers: { id: number; name: string }[]
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(branchSchema),
    defaultValues: { code: '', name: '', ...initial },
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
    const res = await fetch(id ? `/api/branches/${id}` : '/api/branches', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, managerUserId: values.managerUserId || null }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not save the branch.')
      return
    }
    toast.success(`Branch ${id ? 'updated' : 'created'}.`)
    router.push('/settings/branches')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {id ? 'Edit branch' : 'Add branch'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every transaction records its branch, so the code appears throughout reporting.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              id="code"
              label="Branch code"
              required
              error={errors.code?.message}
              hint="Short, unique, appears on reports — e.g. MAIN"
            >
              <Input id="code" className="uppercase" autoFocus {...register('code')} />
            </Field>
            <Field id="name" label="Branch name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </Field>
            <Field
              id="invoicePrefix"
              label="Invoice prefix"
              error={errors.invoicePrefix?.message}
              hint="Leave empty to use the business prefix"
            >
              <Input id="invoicePrefix" className="uppercase" {...register('invoicePrefix')} />
            </Field>
            <Field
              id="managerUserId"
              label="Manager"
              error={errors.managerUserId?.message}
            >
              <FormSelect
                control={control}
                name="managerUserId"
                id="managerUserId"
                label="Branch manager"
                allowEmpty
                emptyLabel="No manager assigned"
                placeholder="No manager assigned"
                options={managers.map((m) => ({ value: String(m.id), label: m.name }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Contact and address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="phone" label="Phone" error={errors.phone?.message}>
              <Input id="phone" type="tel" inputMode="tel" {...register('phone')} />
            </Field>
            <Field id="email" label="Email" error={errors.email?.message}>
              <Input id="email" type="email" {...register('email')} />
            </Field>
            <Field id="gstin" label="GST number" error={errors.gstin?.message}>
              <Input id="gstin" className="uppercase" {...register('gstin')} />
            </Field>
            <Field
              id="stateCode"
              label="GST state"
              error={errors.stateCode?.message}
              hint="A branch in another state bills inter-state (IGST)"
            >
              <FormStateCodeSelect control={control} name="stateCode" id="stateCode" />
            </Field>
            <div className="hidden sm:block" />
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
            <Field id="notes" label="Notes" className="sm:col-span-2" error={errors.notes?.message}>
              <Textarea id="notes" rows={2} {...register('notes')} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/settings/branches">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : id ? 'Save changes' : 'Create branch'}
          </Button>
        </div>
      </form>
    </div>
  )
}
