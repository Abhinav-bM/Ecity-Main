import { shopDateString } from '@/lib/date'
import type { Range } from '@/server/services/analytics.service'

/**
 * Read the shared analytics controls out of the URL.
 *
 * One reader for nine pages, so a link carrying a range means the same thing
 * wherever it lands.
 */
export function rangeFromParams(p: Record<string, string | undefined>): {
  range: Range
  branchId: string
  compare: boolean
} {
  const today = shopDateString()
  const start = new Date(`${today}T00:00:00Z`)
  // A month is the range a shop owner actually looks at most days.
  start.setUTCDate(start.getUTCDate() - 29)

  const from = p.from ?? start.toISOString().slice(0, 10)
  const to = p.to ?? today
  const branchId = p.branchId ?? ''

  return {
    range: {
      from,
      to,
      branchIds: branchId ? [Number(branchId)] : undefined,
    },
    branchId,
    compare: p.compare === '1',
  }
}

/** Basis points as a percentage string. Never a float on money. */
export function formatBp(bp: number | null): string {
  if (bp === null) return '—'
  const sign = bp > 0 ? '+' : ''
  return `${sign}${(bp / 100).toFixed(1)}%`
}
