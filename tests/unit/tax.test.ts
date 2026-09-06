import { describe, expect, it } from 'vitest'
import { computeBill, computeLine } from '@/lib/tax'

const rs = (n: number) => BigInt(Math.round(n * 100))

describe('tax-exclusive pricing', () => {
  it('adds tax on top', () => {
    const line = computeLine(
      { unitPricePaise: rs(1000), quantity: 1, taxRateBasisPoints: 1800 },
      false,
    )
    expect(line.taxablePaise).toBe(rs(1000))
    expect(line.taxPaise).toBe(rs(180))
    expect(line.totalPaise).toBe(rs(1180))
  })

  it('applies the discount before tax', () => {
    const line = computeLine(
      { unitPricePaise: rs(1000), quantity: 2, discountPaise: rs(200), taxRateBasisPoints: 1800 },
      false,
    )
    expect(line.grossPaise).toBe(rs(2000))
    expect(line.taxablePaise).toBe(rs(1800))
    expect(line.taxPaise).toBe(rs(324))
    expect(line.totalPaise).toBe(rs(2124))
  })

  it('handles a zero rate', () => {
    const line = computeLine({ unitPricePaise: rs(500), quantity: 1, taxRateBasisPoints: 0 }, false)
    expect(line.taxPaise).toBe(0n)
    expect(line.totalPaise).toBe(rs(500))
  })
})

describe('tax-inclusive pricing', () => {
  it('extracts tax from the price', () => {
    // ₹1180 at 18% inclusive is ₹1000 + ₹180.
    const line = computeLine(
      { unitPricePaise: rs(1180), quantity: 1, taxRateBasisPoints: 1800 },
      true,
    )
    expect(line.taxablePaise).toBe(rs(1000))
    expect(line.taxPaise).toBe(rs(180))
    expect(line.totalPaise).toBe(rs(1180))
  })

  it('taxable plus tax always equals the total exactly', () => {
    // Awkward amounts where naive rounding leaves a paisa unaccounted for.
    for (const amount of [999, 1, 33, 12345, 7777, 100.01, 0.03]) {
      for (const rate of [0, 500, 1200, 1800, 2800]) {
        const line = computeLine(
          { unitPricePaise: rs(amount), quantity: 3, taxRateBasisPoints: rate },
          true,
        )
        expect(
          line.taxablePaise + line.taxPaise,
          `₹${amount} at ${rate}bp`,
        ).toBe(line.totalPaise)
      }
    }
  })

  it('rounds half-up rather than truncating', () => {
    // ₹100 at 5% inclusive: taxable is 9523.809..., which must not truncate.
    const line = computeLine(
      { unitPricePaise: rs(100), quantity: 1, taxRateBasisPoints: 500 },
      true,
    )
    expect(line.taxablePaise).toBe(9524n)
    expect(line.taxPaise).toBe(476n)
    expect(line.taxablePaise + line.taxPaise).toBe(10000n)
  })
})

describe('bill totals', () => {
  it('sums lines and groups tax by rate, as a GST invoice must', () => {
    const bill = computeBill(
      [
        { unitPricePaise: rs(1000), quantity: 1, taxRateBasisPoints: 1800 },
        { unitPricePaise: rs(500), quantity: 2, taxRateBasisPoints: 1800 },
        { unitPricePaise: rs(300), quantity: 1, taxRateBasisPoints: 500 },
      ],
      false,
    )
    expect(bill.subtotalPaise).toBe(rs(2300))
    expect(bill.taxByRate).toHaveLength(2)
    expect(bill.taxByRate[0]!.rateBasisPoints).toBe(500)
    expect(bill.taxByRate[1]!.taxPaise).toBe(rs(360))
    expect(bill.totalPaise).toBe(rs(2300) + rs(375))
  })

  it('adds up line by line, so an invoice can be checked by hand', () => {
    const lines = [
      { unitPricePaise: 33333n, quantity: 3, taxRateBasisPoints: 1800 },
      { unitPricePaise: 777n, quantity: 7, taxRateBasisPoints: 1200 },
      { unitPricePaise: 1n, quantity: 1, taxRateBasisPoints: 2800 },
    ]
    const bill = computeBill(lines, false)
    const byHand = lines.reduce((sum, l) => sum + computeLine(l, false).totalPaise, 0n)
    expect(bill.totalPaise).toBe(byHand)
    expect(bill.taxablePaise + bill.taxPaise).toBe(bill.totalPaise)
  })

  it('refuses a discount larger than the line', () => {
    expect(() =>
      computeLine(
        { unitPricePaise: rs(100), quantity: 1, discountPaise: rs(200), taxRateBasisPoints: 0 },
        false,
      ),
    ).toThrow(/exceed/i)
  })

  it('refuses an impossible tax rate', () => {
    expect(() =>
      computeLine({ unitPricePaise: rs(100), quantity: 1, taxRateBasisPoints: 20000 }, false),
    ).toThrow(/between 0% and 100%/i)
  })

  it('never loses a paisa across many small lines', () => {
    // 100 lines of ₹0.99 at 18% inclusive - the classic accumulation case.
    const lines = Array.from({ length: 100 }, () => ({
      unitPricePaise: 99n,
      quantity: 1,
      taxRateBasisPoints: 1800,
    }))
    const bill = computeBill(lines, true)
    expect(bill.totalPaise).toBe(9900n)
    expect(bill.taxablePaise + bill.taxPaise).toBe(bill.totalPaise)
  })
})
