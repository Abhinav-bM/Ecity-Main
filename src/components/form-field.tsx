'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

/**
 * One labelled field with its error. Every M1 form uses this, so a field
 * cannot end up without a label or with the error rendered somewhere else.
 */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {/*
          The asterisk is decorative. Without aria-hidden it becomes part of
          the field's accessible name ("IMEI *"), which is what a screen reader
          announces. `required` on the input is what actually conveys it.
        */}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
