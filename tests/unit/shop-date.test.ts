import { describe, expect, it } from 'vitest'
import { addMonths, parseShopDate, parseShopDateEnd, shopDateString } from '@/lib/date'

/*
 * These filters come off a query string, which anyone can edit and which some
 * browsers fill from a plain text box. A value that is not a day used to reach
 * the driver as an Invalid Date and take the page down with it, so the point
 * of every case here is that nothing but a real day gets through.
 */
describe('reading a day off a URL', () => {
  it('accepts the shape a date input produces', () => {
    const at = parseShopDate('2026-09-09')
    expect(at).toBeInstanceOf(Date)
    expect(shopDateString(at!)).toBe('2026-09-09')
  })

  it('anchors the day in the shop, not in the server', () => {
    // 00:00 in Mumbai is 18:30 the day before in UTC. Reading the day in the
    // shop's zone is what keeps a filter meaning the same thing in both.
    expect(parseShopDate('2026-09-09')!.toISOString()).toBe('2026-09-08T18:30:00.000Z')
  })

  it.each([
    ['09/09/2026', 'a browser that renders the field as text'],
    ['2026-9-9', 'single digits'],
    ['yesterday', 'a word'],
    ['2026-09-09T10:00:00Z', 'a timestamp rather than a day'],
    ['', 'nothing typed'],
  ])('refuses %s (%s)', (value) => {
    expect(parseShopDate(value)).toBeUndefined()
  })

  it('refuses a day that does not exist', () => {
    // JS rolls this forward to 3 March rather than refusing it.
    expect(parseShopDate('2026-02-31')).toBeUndefined()
  })

  it('never returns an Invalid Date', () => {
    for (const value of ['09/09/2026', 'x', '0000-00-00', '2026-13-01']) {
      const at = parseShopDate(value)
      expect(at === undefined || !Number.isNaN(at.getTime())).toBe(true)
    }
  })

  it('ends an inclusive range at midnight after the day', () => {
    const end = parseShopDateEnd('2026-09-09')
    expect(shopDateString(end!)).toBe('2026-09-10')
  })

  it('passes a refusal through the end of the range too', () => {
    expect(parseShopDateEnd('09/09/2026')).toBeUndefined()
  })
})

/*
 * A warranty runs from the day the handset arrived. The arithmetic used to be
 * `setMonth`, which overflows: the shop would have honoured a claim three days
 * past what it agreed.
 */
describe('counting months for a warranty', () => {
  it('keeps the same day of the month', () => {
    expect(addMonths(new Date('2026-03-15T00:00:00'), 6).toDateString()).toBe(
      new Date('2026-09-15T00:00:00').toDateString(),
    )
  })

  it('does not run past the end of a shorter month', () => {
    // 31 August + 6 months is not 31 February.
    expect(addMonths(new Date('2025-08-31T00:00:00'), 6).toDateString()).toBe(
      new Date('2026-02-28T00:00:00').toDateString(),
    )
  })

  it('uses the 29th in a leap year', () => {
    expect(addMonths(new Date('2023-08-31T00:00:00'), 6).toDateString()).toBe(
      new Date('2024-02-29T00:00:00').toDateString(),
    )
  })

  it('carries across a year end', () => {
    expect(addMonths(new Date('2026-11-20T00:00:00'), 3).toDateString()).toBe(
      new Date('2027-02-20T00:00:00').toDateString(),
    )
  })
})
