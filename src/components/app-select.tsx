'use client'

import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type SelectOption = { value: string; label: string; disabled?: boolean }

/**
 * The one dropdown in the app.
 *
 * A native <select> renders as the operating system's own control — a wheel
 * picker on iOS — which looks nothing like the rest of the app and cannot be
 * styled. Every dropdown goes through here so they all look and behave the
 * same, and so a change lands everywhere at once.
 *
 * Tests drive it as a combobox: click the trigger, then pick a role="option".
 */
export function AppSelect({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled,
  className,
  allowEmpty,
  emptyLabel = 'Any',
}: {
  id?: string
  /** Accessible name. Required — tests and screen readers both rely on it. */
  label: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Offer a "no selection" row, for filters and optional fields. */
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  // Radix cannot hold an empty string as a value, so "no selection" travels
  // as a sentinel and is translated back at the boundary.
  const EMPTY = '__none__'

  return (
    <Select
      value={value === '' ? EMPTY : value}
      onValueChange={(v) => onValueChange(v === EMPTY ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty ? <SelectItem value={EMPTY}>{emptyLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The same control, bound to react-hook-form.
 *
 * `register` only works on real form elements, and this is not one, so the
 * value has to be wired through a Controller.
 */
export function FormSelect<T extends FieldValues>({
  control,
  name,
  ...rest
}: {
  control: Control<T>
  name: Path<T>
} & Omit<Parameters<typeof AppSelect>[0], 'value' | 'onValueChange'>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <AppSelect
          {...rest}
          value={field.value == null ? '' : String(field.value)}
          onValueChange={field.onChange}
        />
      )}
    />
  )
}
