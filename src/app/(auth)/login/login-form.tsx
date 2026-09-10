'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { loginSchema } from '@/lib/validation'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiFetch } from '@/lib/api'

type Values = z.infer<typeof loginSchema>

/**
 * Where to land after signing in - and only ever inside this app.
 *
 * `?next=` is set by the API client when a request comes back unauthenticated,
 * so it is whatever was in the address bar, and that makes it attacker-supplied
 * in a link. Only a plain absolute path is honoured: `//evil.example` is a
 * protocol-relative URL, and browsers normalise the backslash in
 * `/\evil.example` to the same thing, so both are refused.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/')) return '/dashboard'
  if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard'
  return next
}

export function LoginForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: Values) {
    setFormError(null)
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      setFormError(res.error)
      return
    }
    // Back to whatever the session expired on, when there was one.
    router.replace(safeNext(new URLSearchParams(window.location.search).get('next')))
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your work email and password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormError message={formError} />

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" autoFocus {...register('email')} />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            <Link
              href="/forgot-password"
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              Forgotten your password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
