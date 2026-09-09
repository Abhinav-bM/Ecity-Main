'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { shopDateString } from '@/lib/date'

/** Matches only a complete calendar day. A half-typed date is not one. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The one date field in the app.
 *
 * A bare <input type="date"> in a toolbar has three problems. It carries no
 * visible name, so a pair of them reads as two empty boxes. Driven straight
 * from the URL it is a controlled input whose value only catches up after a
 * round trip, so a chosen date visibly snaps back before it takes. And a
 * browser that renders the field as plain text hands back whatever was typed,
 * which is how a filter value ended up as an Invalid Date and took the page
 * down with it.
 *
 * So: the native control stays underneath - it is the operating system's own
 * picker, which on a phone is a wheel a salesperson can actually use - and
 * everything around it is ours. The value is held here, and only a real,
 * whole day is ever handed upwards.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  clearable = true,
  className,
  id,
}: {
  /** Accessible name, and the caption above the box. */
  label: string
  /** yyyy-mm-dd, or '' for no date. */
  value: string
  /** Called with a whole valid day, or '' when cleared. Never with a partial. */
  onChange: (value: string) => void
  min?: string
  max?: string
  /** A filter can be emptied again; a required field cannot. */
  clearable?: boolean
  className?: string
  id?: string
}) {
  const generated = useId()
  const inputId = id ?? generated
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)

  // The URL is still the authority: a back button, or a preset button
  // elsewhere on the toolbar, has to be able to move this field.
  useEffect(() => setDraft(value), [value])

  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <label htmlFor={inputId} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <div
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-colors',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={ref}
          id={inputId}
          type="date"
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent outline-none [&::-webkit-calendar-picker-indicator]:opacity-0"
          value={draft}
          min={min}
          max={max}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            // '' is a deliberate clear and travels. A partial does not.
            if (next === '' || ISO_DAY.test(next)) onChange(next)
          }}
        />
        {clearable && draft ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDraft('')
              onChange('')
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export type DatePreset = { label: string; from: string; to: string }

/**
 * The ranges a shop actually asks for.
 *
 * Nobody reviewing a day's takings wants to pick both ends by hand, and
 * "this month" typed as two dates is two chances to get it wrong.
 */
export function rangePresets(today: Date = new Date()): DatePreset[] {
  const day = (d: Date) => shopDateString(d)
  const shift = (days: number) => new Date(today.getTime() + days * 86_400_000)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

  return [
    { label: 'Today', from: day(today), to: day(today) },
    { label: 'Last 7 days', from: day(shift(-6)), to: day(today) },
    { label: 'This month', from: day(monthStart), to: day(today) },
    { label: 'Last month', from: day(lastMonthStart), to: day(lastMonthEnd) },
  ]
}

/**
 * A pair of days, with the shortcuts.
 *
 * Both ends move together so a range is applied once rather than as two
 * separate reloads, and neither end can be set past the other.
 */
export function DateRangeField({
  from,
  to,
  onApply,
  presets = rangePresets(),
  max,
  className,
}: {
  from: string
  to: string
  onApply: (range: { from: string; to: string }) => void
  presets?: DatePreset[]
  max?: string
  className?: string
}) {
  const active = presets.find((p) => p.from === from && p.to === to)

  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <DateField
        label="From"
        value={from}
        max={to || max}
        onChange={(v) => onApply({ from: v, to })}
        className="w-40"
      />
      <DateField
        label="To"
        value={to}
        min={from || undefined}
        max={max}
        onChange={(v) => onApply({ from, to: v })}
        className="w-40"
      />
      <div className="flex flex-wrap gap-1 pb-0.5">
        {presets.map((p) => (
          <Button
            key={p.label}
            type="button"
            size="sm"
            variant={active?.label === p.label ? 'secondary' : 'ghost'}
            className="h-9 text-xs"
            onClick={() => onApply({ from: p.from, to: p.to })}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
