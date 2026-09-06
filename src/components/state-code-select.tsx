import type { ComponentPropsWithoutRef } from 'react'
import { GST_STATE_CODES } from '@/lib/gst'

const OPTIONS = Object.entries(GST_STATE_CODES).sort((a, b) => a[1].localeCompare(b[1]))

/**
 * GST state code picker (PRD OQ-4).
 *
 * The *code* is what decides CGST/SGST versus IGST on an invoice, so that is
 * what gets stored; the name is only ever shown. Blank is allowed — a shop
 * with no GST registration has no code, and the invoice then leaves the
 * place-of-supply line off rather than printing a guess.
 */
export function StateCodeSelect(props: ComponentPropsWithoutRef<'select'>) {
  return (
    <select
      {...props}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <option value="">Not set</option>
      {OPTIONS.map(([code, name]) => (
        <option key={code} value={code}>
          {name} ({code})
        </option>
      ))}
    </select>
  )
}
