import { GST_STATE_CODES } from '@/lib/gst'
import type { Control, FieldValues, Path } from 'react-hook-form'
import { AppSelect, FormSelect } from '@/components/app-select'

const OPTIONS = Object.entries(GST_STATE_CODES)
  .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
  .sort((a, b) => a.label.localeCompare(b.label))

/**
 * GST state code picker (PRD OQ-4).
 *
 * The *code* is what decides CGST/SGST versus IGST on an invoice, so that is
 * what gets stored; the name is only ever shown. Blank is allowed — a shop
 * with no GST registration has no code, and the invoice then leaves the
 * place-of-supply line off rather than printing a guess.
 */
export function StateCodeSelect({
  id,
  value,
  onValueChange,
  disabled,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <AppSelect
      id={id}
      label="GST state"
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      allowEmpty
      emptyLabel="Not set"
      placeholder="Not set"
      options={OPTIONS}
    />
  )
}

/** The same picker bound to react-hook-form. */
export function FormStateCodeSelect<T extends FieldValues>({
  control,
  name,
  id,
  disabled,
}: {
  control: Control<T>
  name: Path<T>
  id?: string
  disabled?: boolean
}) {
  return (
    <FormSelect
      control={control}
      name={name}
      id={id}
      label="GST state"
      disabled={disabled}
      allowEmpty
      emptyLabel="Not set"
      placeholder="Not set"
      options={OPTIONS}
    />
  )
}
