/**
 * The shop's calendar day, not the browser's.
 *
 * `new Date().toISOString().slice(0, 10)` is UTC. In India that is a different
 * day between midnight and 05:30 every night: the till is open, the drawer is
 * on today's business date, and the browser thinks it is yesterday. An expense
 * form defaulting to yesterday would post into a day that may already be
 * closed, and its `max` would stop anyone choosing the day they are actually
 * standing in.
 *
 * Everything user-facing that means "today at the shop" comes from here, and
 * the server's `businessDateFor` uses the same zone, so the two cannot drift.
 */
export const SHOP_TIME_ZONE = 'Asia/Kolkata'

/** yyyy-mm-dd in the shop's timezone. `en-CA` renders exactly that shape. */
export function shopDateString(when: Date = new Date(), timeZone = SHOP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when)
}

/** Matches only the shape a date input produces, and nothing else. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A calendar day from a URL, or nothing.
 *
 * A query string is typed by whoever is holding the address bar, and some
 * browsers hand back whatever was typed into a date field rather than an ISO
 * day. `new Date('09/09/2026T00:00:00')` is an Invalid Date, which survives
 * every check until the driver tries to send it and throws - so the page dies
 * on a filter value instead of ignoring it. Anything not a real day is nothing.
 *
 * The day is anchored in the shop's zone, not the server's, so a filter means
 * the same day whether it is read in Mumbai or in a datacentre on UTC.
 */
export function parseShopDate(value: string | undefined | null): Date | undefined {
  if (!value || !ISO_DAY.test(value)) return undefined
  const at = new Date(`${value}T00:00:00+05:30`)
  if (Number.isNaN(at.getTime())) return undefined
  // 2026-02-31 parses, as 3 March. A day that renders back as itself is real.
  return shopDateString(at) === value ? at : undefined
}

/** The day after `value`, so an inclusive "to" covers the whole of it. */
export function parseShopDateEnd(value: string | undefined | null): Date | undefined {
  const at = parseShopDate(value)
  if (!at) return undefined
  at.setDate(at.getDate() + 1)
  return at
}

/**
 * The same day of the month, `months` later.
 *
 * `setMonth` overflows: 31 August plus six months is 31 February, which the
 * browser silently turns into 3 March. A warranty sold on the last day of a
 * month would then run three days long, and the shop would honour a claim it
 * had not agreed to. The last day of a month maps to the last day of the
 * target month instead.
 */
export function addMonths(from: Date, months: number): Date {
  const at = new Date(from.getTime())
  const day = at.getDate()
  at.setDate(1)
  at.setMonth(at.getMonth() + months)
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()
  at.setDate(Math.min(day, lastDay))
  return at
}
