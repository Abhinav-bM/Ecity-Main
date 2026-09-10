import { parseShopDate, shopDateString } from '@/lib/date'
import type { Range } from '@/server/services/analytics.service'

/** A real calendar day, or null. `parseShopDate` already rejects 2026-02-31. */
const validDay = (value: string | undefined): string | null =>
  parseShopDate(value) ? (value as string) : null

/**
 * Read the shared analytics controls out of the URL.
 *
 * One reader for nine pages, so a link carrying a range means the same thing
 * wherever it lands - and, because these values come from the address bar and
 * from links people paste to each other, one place where a nonsensical range
 * is turned back into a sensible one.
 *
 * It falls back rather than throwing. `?from=lastweek` is a mistyped link, not
 * an attack, and the useful response is this month's figures, not an error
 * page. What must not happen is what used to: the text going straight into
 * `new Date`, and `previousRange` then throwing "Invalid time value" out of a
 * server component - which took all nine screens down.
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
  const defaultFrom = start.toISOString().slice(0, 10)

  let from = validDay(p.from) ?? defaultFrom
  let to = validDay(p.to) ?? today
  // A range typed back to front is a slip worth honouring rather than refusing.
  if (from > to) [from, to] = [to, from]

  // Only a real branch id gets through; `Number('abc')` is NaN, and NaN in an
  // `in (…)` clause is a query error rather than an empty result.
  const parsedBranch = Number(p.branchId)
  const branchId =
    p.branchId && Number.isInteger(parsedBranch) && parsedBranch > 0 ? p.branchId : ''

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
