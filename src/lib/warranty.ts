/**
 * Who honours a warranty (PRD FR-29.1).
 *
 * Stored as UPPER_SNAKE codes, which is how every other coded value in this
 * app is spelled — main types, device statuses, payment method types, sale
 * statuses. A code is not a label: it survives a rename on screen, it sorts
 * and groups reliably, and `changes.ts` already renders this shape as English
 * in the audit log without being told about it.
 *
 * It was free text. A field two people spell differently cannot be grouped:
 * "Brand", "brand", "Brand India" and "BRAND" are four providers as far as
 * the warranty screen is concerned, and whether the shop or the manufacturer
 * stands behind a handset is the whole question a claim turns on.
 *
 * The column stays `text` rather than becoming a database enum, for one
 * reason: handsets booked in before this — and every row an import brought in
 * — carry free text like "Brand India", and an enum would refuse them. Those
 * are shown as they were recorded; see `warrantyProviderLabel`.
 */

export const WARRANTY_PROVIDERS = [
  { value: 'BRAND_WARRANTY', label: 'Brand warranty' },
  { value: 'SHOP_WARRANTY', label: 'Shop warranty' },
] as const

export type WarrantyProvider = (typeof WARRANTY_PROVIDERS)[number]['value']

const LABELS: Record<string, string> = Object.fromEntries(
  WARRANTY_PROVIDERS.map((p) => [p.value, p.label]),
)

/**
 * The provider as a person should read it.
 *
 * Anything not a known code is passed through untouched, which is what keeps
 * older records readable: a handset recorded as "Brand India" still says
 * "Brand India" rather than being blanked or mangled into a code it never had.
 */
export function warrantyProviderLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return LABELS[value] ?? value
}
