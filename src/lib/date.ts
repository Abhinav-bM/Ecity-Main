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
