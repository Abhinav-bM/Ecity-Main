import { formatPaise } from '@/lib/utils'

/**
 * Turning an audit diff into something a shopkeeper can read.
 *
 * The log stores `{ field: { from, to } }`, which the screen used to print as
 * raw JSON. That is a developer's view on a page the owner is meant to use to
 * answer "who changed this price?" — and `"sellingPricePaise": { "to": 1400000 }`
 * does not answer it. This turns the same data into a sentence.
 *
 * Nothing is invented: every value shown is the value stored. Only the
 * spelling changes.
 */

export type Change = { from: unknown; to: unknown }

/** Field names people recognise, where the column name is not one. */
const LABELS: Record<string, string> = {
  gstin: 'GSTIN',
  imeiSlots: 'IMEI fields per device',
  isNewCut: 'NEW CUT',
  isSerialised: 'Tracked individually',
  isActive: 'Active',
  gstEnabled: 'GST',
  branchIds: 'Branches',
  roleId: 'Role',
  categoryId: 'Category',
  brandId: 'Brand',
  managerUserId: 'Manager',
  stateCode: 'State code',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  supplierInvoiceNumber: 'Supplier bill number',
  salesChannel: 'Sales channel',
  identifierType: 'Identifier type',
  newCutNotes: 'NEW CUT notes',
}

/**
 * `sellingPricePaise` -> `Selling price`.
 *
 * The storage suffixes are an implementation detail: money is bigint paise
 * and rates are integer basis points (docs/03 §4.1), and neither belongs on
 * a screen.
 */
export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key]

  const spelled = key
    .replace(/Paise$/, '')
    .replace(/BasisPoints$/, '')
    .replace(/Id$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()

  return spelled.charAt(0).toUpperCase() + spelled.slice(1)
}

/** One stored value, spelled for a person. */
export function fieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'

  if (typeof value === 'boolean') return value ? 'yes' : 'no'

  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.join(', ')
  }

  if (value instanceof Date) return value.toISOString().slice(0, 10)

  // Money is stored in paise and rates in basis points; both are integers
  // precisely so they are never floats (docs/03 §4.1).
  if (/Paise$/.test(key) && (typeof value === 'number' || typeof value === 'string')) {
    return formatPaise(BigInt(value))
  }
  if (/BasisPoints$/.test(key) && (typeof value === 'number' || typeof value === 'string')) {
    return `${Number(value) / 100}%`
  }

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

  // ISO timestamps read as machine output; the date is the part that matters.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10)

  // UPPER_SNAKE enums are how the database spells them, not how people do.
  if (/^[A-Z][A-Z_]+$/.test(text)) return text.replace(/_/g, ' ').toLowerCase()

  return text
}

/**
 * The whole change as one line.
 *
 * Three shapes, because "changed from nothing to X" is a clumsy way to say
 * something was set, and the log is mostly creates.
 */
export function describeChange(key: string, change: Change): string {
  const label = fieldLabel(key)
  const from = change.from
  const to = change.to

  const wasEmpty = from === null || from === undefined || from === ''
  const isEmpty = to === null || to === undefined || to === ''

  if (wasEmpty && isEmpty) return `${label} unchanged`
  if (wasEmpty) return `${label} set to ${fieldValue(key, to)}`
  if (isEmpty) return `${label} cleared (was ${fieldValue(key, from)})`
  return `${label}: ${fieldValue(key, from)} → ${fieldValue(key, to)}`
}

/** Every change on one audit row, in a stable order. */
export function describeChanges(changes: Record<string, Change> | null | undefined): string[] {
  if (!changes) return []
  return Object.entries(changes)
    .sort(([a], [b]) => fieldLabel(a).localeCompare(fieldLabel(b)))
    .map(([key, change]) => describeChange(key, change))
}
