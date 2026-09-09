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

describe('GST split on a bill (OQ-4: statutory invoices)', () => {
  const line = (hsn: string, price: bigint, qty: number, bp: number) => ({
    hsnCode: hsn,
    unitPricePaise: price,
    quantity: qty,
    taxRateBasisPoints: bp,
  })

  it('splits an intra-state bill into CGST and SGST that add back to the tax', () => {
    const bill = computeBill([line('8517', 7499900n, 1, 1800)], true, 0n, false)
    expect(bill.cgstPaise + bill.sgstPaise).toBe(bill.taxPaise)
    expect(bill.igstPaise).toBe(0n)
    expect(bill.taxablePaise + bill.taxPaise).toBe(bill.totalPaise)
  })

  it('puts everything in IGST across state lines', () => {
    const bill = computeBill([line('8517', 7499900n, 1, 1800)], true, 0n, true)
    expect(bill.igstPaise).toBe(bill.taxPaise)
    expect(bill.cgstPaise).toBe(0n)
    expect(bill.sgstPaise).toBe(0n)
  })

  it('the customer pays the same either way', () => {
    const intra = computeBill([line('8517', 7499900n, 1, 1800)], true, 0n, false)
    const inter = computeBill([line('8517', 7499900n, 1, 1800)], true, 0n, true)
    expect(intra.totalPaise).toBe(inter.totalPaise)
    expect(intra.taxPaise).toBe(inter.taxPaise)
  })

  it('the HSN summary adds up to the bill', () => {
    const bill = computeBill(
      [
        line('8517', 7499900n, 1, 1800),
        line('8517', 19900n, 3, 1800),
        line('8544', 25000n, 2, 1200),
      ],
      true,
      0n,
      false,
    )
    // Same HSN at the same rate collapses to one row; a different rate does not.
    expect(bill.hsnSummary).toHaveLength(2)
    const summed = bill.hsnSummary.reduce(
      (acc, r) => ({
        taxable: acc.taxable + r.taxablePaise,
        tax: acc.tax + r.taxPaise,
        cgst: acc.cgst + r.cgstPaise,
        sgst: acc.sgst + r.sgstPaise,
      }),
      { taxable: 0n, tax: 0n, cgst: 0n, sgst: 0n },
    )
    expect(summed.taxable).toBe(bill.taxablePaise)
    expect(summed.tax).toBe(bill.taxPaise)
    expect(summed.cgst).toBe(bill.cgstPaise)
    expect(summed.sgst).toBe(bill.sgstPaise)
    expect(bill.hsnSummary.find((r) => r.hsnCode === '8517')!.quantity).toBe(4)
  })

  it('the per-rate breakdown carries its own split', () => {
    const bill = computeBill(
      [line('8517', 100000n, 1, 1800), line('8544', 100000n, 1, 500)],
      false,
      0n,
      false,
    )
    for (const row of bill.taxByRate) {
      expect(row.cgstPaise + row.sgstPaise).toBe(row.taxPaise)
    }
    expect(bill.taxByRate.map((r) => r.rateBasisPoints)).toEqual([500, 1800])
  })

  it('never loses a paisa across 100 odd-tax lines', () => {
    // 99 paise at 18% inclusive gives an odd tax, which is where a naive
    // halving would drift a rupee over a long bill.
    const lines = Array.from({ length: 100 }, () => line('8517', 99n, 1, 1800))
    const bill = computeBill(lines, true, 0n, false)
    expect(bill.cgstPaise + bill.sgstPaise).toBe(bill.taxPaise)
    expect(bill.taxablePaise + bill.taxPaise).toBe(bill.totalPaise)
    expect(bill.totalPaise).toBe(9900n)
  })

  it('a line with no HSN stays out of the summary but still counts in the totals', () => {
    const bill = computeBill(
      [{ unitPricePaise: 50000n, quantity: 1, taxRateBasisPoints: 1800 }],
      true,
      0n,
      false,
    )
    expect(bill.hsnSummary).toHaveLength(0)
    expect(bill.taxPaise).toBeGreaterThan(0n)
  })
})

/*
 * A discount comes off. That sounds too obvious to test, but the till used to
 * assume every shop prices tax-inclusive while the server asked the shop, so
 * on a tax-exclusive shop the screen showed one figure and the saved bill was
 * larger - which reads exactly like the discount had been added on.
 */
describe('a discount only ever reduces the bill', () => {
  const line = { unitPricePaise: rs(10_000), quantity: 1, taxRateBasisPoints: 1800 }

  it.each([true, false])('under pricesIncludeTax=%s', (inclusive) => {
    const full = computeBill([line], inclusive).totalPaise
    const discounted = computeBill([{ ...line, discountPaise: rs(500) }], inclusive).totalPaise
    expect(discounted).toBeLessThan(full)
    expect(full - discounted).toBe(inclusive ? rs(500) : rs(590))
  })

  it('reports what came off, so the screen can show it', () => {
    const bill = computeBill([{ ...line, discountPaise: rs(500) }], true)
    expect(bill.subtotalPaise).toBe(rs(10_000))
    expect(bill.discountPaise).toBe(rs(500))
    expect(bill.totalPaise).toBe(rs(9_500))
  })
})
