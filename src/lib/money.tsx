/** Money display. Paise in, rupees out — the only place the conversion happens. */
export function formatMoney(paise: bigint | number | null | undefined): string {
  if (paise == null) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(paise) / 100)
}
