'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { forgotPasswordSchema } from '@/lib/validation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Values = z.infer<typeof forgotPasswordSchema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [devToken, setDevToken] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) })

  async function onSubmit(values: Values) {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    const data = (await res.json()) as { devToken?: string }
    setDevToken(data.devToken ?? null)
    setSent(true)
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If that address is registered, a reset link is on its way. The link expires in one hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devToken ? (
            <Alert variant="warning">
              <p className="font-medium">Development only</p>
              <p className="mt-1 break-all">
                Email is not wired up until M13. Use this link:{' '}
                <Link
                  className="underline underline-offset-4"
                  href={`/reset-password?token=${devToken}`}
                >
                  /reset-password?token={devToken.slice(0, 12)}…
                </Link>
              </p>
            </Alert>
          ) : null}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We will email you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoFocus {...register('email')} />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
