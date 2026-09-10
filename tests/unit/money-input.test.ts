import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MAX_QUANTITY,
  MAX_RUPEES,
  parseQuantity,
  parseRupees,
  rupeeAmount,
  rupeesToPaise,
} from '@/lib/validation'
import { computeBill, computeLine } from '@/lib/tax'

/**
 * The figures a keyboard can produce that arithmetic cannot.
 *
 * `Number("Infinity")` and `Number("1e400")` are both perfectly good numbers as
 * far as `z.coerce.number().min(0)` is concerned, and both make `BigInt()`
 * throw. On the server that surfaced as a 500 from the bill endpoint; in the
 * browser it threw inside a render, which took the whole till down mid-sale.
 */
describe('money and quantity input', () => {
  describe('rupeeAmount (the schema at the edge)', () => {
    const schema = rupeeAmount()

    it.each(['Infinity', '-Infinity', '1e400', 'NaN'])('refuses %s', (raw) => {
      expect(schema.safeParse(raw).success).toBe(false)
    })

    it('refuses an amount past the ceiling, which would overflow the paise column', () => {
      expect(schema.safeParse(MAX_RUPEES + 1).success).toBe(false)
    })

    it('accepts ordinary money', () => {
      expect(schema.parse('1999.50')).toBe(1999.5)
      expect(schema.parse(0)).toBe(0)
      expect(schema.parse(MAX_RUPEES)).toBe(MAX_RUPEES)
    })

    it('respects a caller-supplied floor', () => {
      const positive = rupeeAmount({ min: 0.01, minMessage: 'Must be more than zero.' })
      expect(positive.safeParse(0).success).toBe(false)
      expect(positive.parse(0.01)).toBe(0.01)
    })

    it('leaves a sale line unable to smuggle an infinite price past validation', () => {
      const line = z.object({ unitPrice: rupeeAmount(), quantity: z.coerce.number().int().min(1) })
      expect(line.safeParse({ unitPrice: 'Infinity', quantity: 1 }).success).toBe(false)
    })
  })

  describe('rupeesToPaise (the second line of defence)', () => {
    it('converts, rounding half up', () => {
      expect(rupeesToPaise(10.005)).toBe(1001n)
      expect(rupeesToPaise(-10.005)).toBe(-1001n)
    })

    it('refuses what it cannot convert, instead of raising a bare RangeError deep in a write', () => {
      expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(RangeError)
      expect(() => rupeesToPaise(Number.NaN)).toThrow(RangeError)
      expect(() => rupeesToPaise(1e300)).toThrow(RangeError)
    })
  })

  describe('parseRupees (what a render may safely use)', () => {
    it('never throws, whatever is in the box', () => {
      for (const raw of ['', 'abc', 'Infinity', '1e400', '-', '.', null, undefined, NaN]) {
        expect(() => rupeesToPaise(parseRupees(raw))).not.toThrow()
      }
    })

    it('treats a half-typed number as nothing rather than as a crash', () => {
      expect(parseRupees('')).toBe(0)
      expect(parseRupees('abc')).toBe(0)
      expect(parseRupees('Infinity')).toBe(0)
    })

    it('keeps a real figure intact', () => {
      expect(parseRupees('1250.75')).toBe(1250.75)
      expect(parseRupees(99)).toBe(99)
    })

    it('clamps rather than overflowing', () => {
      expect(parseRupees(1e30)).toBe(MAX_RUPEES)
    })
  })

  describe('parseQuantity', () => {
    it('refuses a fraction, which computeLine throws on', () => {
      expect(parseQuantity('1.5')).toBe(1)
      expect(parseQuantity('2.9')).toBe(2)
    })

    it('refuses an infinite count, which BigInt throws on', () => {
      expect(parseQuantity('Infinity')).toBe(1)
      expect(parseQuantity('1e400')).toBe(1)
    })

    it('holds the floor and the ceiling', () => {
      expect(parseQuantity('0')).toBe(1)
      expect(parseQuantity('-5')).toBe(1)
      expect(parseQuantity('999999999')).toBe(MAX_QUANTITY)
      expect(parseQuantity('0', { min: 0 })).toBe(0)
    })
  })

  describe('the till can no longer be crashed by what is typed into it', () => {
    /** Exactly what billing-screen.tsx does on every keystroke. */
    const previewLine = (unitPrice: string, discount: string, quantity: string) =>
      computeLine(
        {
          unitPricePaise: rupeesToPaise(parseRupees(unitPrice)),
          quantity: parseQuantity(quantity),
          discountPaise: rupeesToPaise(parseRupees(discount)),
          taxRateBasisPoints: 1800,
        },
        true,
      )

    it.each([
      ['Infinity', '0', '1'],
      ['1e400', '0', '1'],
      ['500', 'Infinity', '1'],
      ['500', '0', '1.5'],
      ['500', '0', 'Infinity'],
      ['', '', ''],
      ['abc', 'xyz', 'nope'],
    ])('survives price=%s discount=%s qty=%s', (price, discount, qty) => {
      expect(() => previewLine(price, discount, qty)).not.toThrow()
    })

    it('still computes the right bill for real input', () => {
      const totals = computeBill(
        [
          {
            unitPricePaise: rupeesToPaise(parseRupees('1180')),
            quantity: parseQuantity('2'),
            discountPaise: rupeesToPaise(parseRupees('180')),
            taxRateBasisPoints: 1800,
          },
        ],
        true,
      )
      // 2 x 1180 = 2360, less 180 = 2180 inclusive of 18%.
      expect(totals.totalPaise).toBe(218000n)
      expect(totals.taxablePaise + totals.taxPaise).toBe(218000n)
    })
  })
})
