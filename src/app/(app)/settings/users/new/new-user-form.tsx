'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { z } from 'zod'
import { createUserSchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormSelect } from '@/components/app-select'

type Values = z.infer<typeof createUserSchema>

export function NewUserForm({
  roles,
  branches,
}: {
  roles: { id: number; name: string }[]
  branches: { id: number; code: string; name: string }[]
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[]>([])

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { branchIds: [] },
  })

  function toggleBranch(id: number, checked: boolean) {
    const next = checked ? [...selected, id] : selected.filter((b) => b !== id)
    setSelected(next)
    setValue('branchIds', next)
  }

  async function onSubmit(values: Values) {
    setFormError(null)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      setFormError(data.error ?? 'Could not create the user.')
      return
    }
    toast.success('User created. They must change their password at first sign-in.')
    router.push('/settings/users')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Add user</h1>
        <p className="text-sm text-muted-foreground">
          The user is required to change this password the first time they sign in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Details</CardTitle>
          <CardDescription>Role decides what they can do; branches decide where.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {formError ? <Alert variant="destructive">{formError}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoFocus {...register('name')} />
                {errors.name ? (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email ? (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" {...register('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="roleId">Role</Label>
                <FormSelect
                  control={control}
                  name="roleId"
                  id="roleId"
                  label="Role"
                  placeholder="Choose a role…"
                  options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
                />
                {errors.roleId ? (
                  <p className="text-xs text-destructive">{errors.roleId.message}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Initial password</Label>
              <Input id="password" type="password" autoComplete="new-password"
                {...register('password')} />
              {errors.password ? (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Branches</Label>
              {branches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No branches exist yet. Branch management arrives in M1.
                </p>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  {branches.map((b) => (
                    <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected.includes(b.id)}
                        onCheckedChange={(c) => toggleBranch(b.id, c === true)}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
                      {b.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Leave empty only for an Admin who holds “View all branches”.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
                <Link href="/settings/users">Cancel</Link>
              </Button>
              <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
                {isSubmitting ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
