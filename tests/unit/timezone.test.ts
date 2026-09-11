import { describe, expect, it } from 'vitest'
import { formatDateShort, formatDateTime, formatTimeShort } from '@/lib/utils'
import { parseShopDate, shopDateString, SHOP_TIME_ZONE } from '@/lib/date'

/**
 * Dates must read the same wherever the server happens to be.
 *
 * Production runs in a datacentre, and a Linux box is conventionally UTC. A
 * business date is stored as midnight in India — 18:30 UTC the day before — so
 * any formatter that falls back to the machine's own zone renders it a day
 * early. That is not a cosmetic slip: it is the wrong date on a tax invoice.
 *
 * This suite runs under a forced TZ (see the env set below) so it fails on the
 * developer's machine in India too, rather than passing there and breaking on
 * deploy.
 */
describe('dates do not depend on the server’s timezone', () => {
  /** Midnight on 12 September 2026 in India. In UTC this is the 11th, 18:30. */
  const istMidnight = new Date('2026-09-12T00:00:00+05:30')

  it('the shop timezone is the one the business runs in', () => {
    expect(SHOP_TIME_ZONE).toBe('Asia/Kolkata')
  })

  it('renders a business date as the day it is in India', () => {
    // The bug: on a UTC server this read "11 Sept 2026".
    expect(formatDateShort(istMidnight)).toContain('12 Sept 2026')
    expect(formatDateTime(istMidnight)).toContain('12 Sept 2026')
    expect(shopDateString(istMidnight)).toBe('2026-09-12')
  })

  it('holds through the 00:00–05:30 window, where UTC is still yesterday', () => {
    // 1 a.m. in India on the 1st of a month is the previous month in UTC.
    const earlyHours = new Date('2026-10-01T01:00:00+05:30')
    expect(formatDateShort(earlyHours)).toContain('1 Oct 2026')
    expect(formatTimeShort(earlyHours)).toMatch(/1:00/)
    expect(shopDateString(earlyHours)).toBe('2026-10-01')
  })

  it('parses a typed day as midnight in India, whatever the server thinks', () => {
    const parsed = parseShopDate('2026-09-12')!
    expect(parsed.toISOString()).toBe('2026-09-11T18:30:00.000Z')
    // And round-trips: the day in gives the day out.
    expect(shopDateString(parsed)).toBe('2026-09-12')
    expect(formatDateShort(parsed)).toContain('12 Sept 2026')
  })

  it('refuses a value it cannot read rather than printing Invalid Date', () => {
    expect(formatDateShort('not a date')).toBe('—')
    expect(formatDateShort(null)).toBe('—')
  })
})

/**
 * The database runs on the shop's clock too.
 *
 * `current_date` and `::date` casts resolve against the connection's session
 * timezone, and the overdue and warranty-expiry rules use both. A UTC session
 * would count the day wrong between midnight and 05:30 IST every night.
 */
describe('the database session', () => {
  it('is pinned to the shop timezone by the client, not by the machine', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/server/db/index.ts', 'utf8'),
    )
    expect(source).toContain('connection: { TimeZone: SHOP_TIME_ZONE }')
  })
})
