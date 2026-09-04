import { describe, expect, it } from 'vitest'
import {
  branchSchema,
  businessProfileSchema,
  gstinSchema,
  partySchema,
  taxRateSchema,
  toBasisPoints,
  toPercent,
} from '@/lib/validation'

describe('tax rate conversion', () => {
  it('converts percent to exact integer basis points', () => {
    expect(toBasisPoints(18)).toBe(1800)
    expect(toBasisPoints(5)).toBe(500)
    expect(toBasisPoints(0)).toBe(0)
    expect(toBasisPoints(28)).toBe(2800)
  })

  it('handles two decimal places without float drift', () => {
    // 18.99 * 100 is 1898.9999... in binary floating point.
    expect(toBasisPoints(18.99)).toBe(1899)
    expect(toBasisPoints(0.01)).toBe(1)
    expect(toBasisPoints(12.5)).toBe(1250)
  })

  it('round-trips', () => {
    for (const p of [0, 5, 12, 18, 28, 12.5, 18.99]) {
      expect(toPercent(toBasisPoints(p))).toBeCloseTo(p, 2)
    }
  })
})

describe('tax rate schema', () => {
  it('rejects more than two decimal places', () => {
    expect(taxRateSchema.safeParse({ name: 'x', ratePercent: 18.001 }).success).toBe(false)
  })

  it('rejects out-of-range rates', () => {
    expect(taxRateSchema.safeParse({ name: 'x', ratePercent: -1 }).success).toBe(false)
    expect(taxRateSchema.safeParse({ name: 'x', ratePercent: 101 }).success).toBe(false)
  })

  it('accepts a normal GST slab', () => {
    expect(taxRateSchema.safeParse({ name: 'GST 18%', ratePercent: 18 }).success).toBe(true)
  })
})

describe('GSTIN', () => {
  it('accepts a well-formed number', () => {
    expect(gstinSchema.safeParse('29ABCDE1234F1Z5').success).toBe(true)
  })

  it('upper-cases input', () => {
    expect(gstinSchema.parse('29abcde1234f1z5')).toBe('29ABCDE1234F1Z5')
  })

  it('rejects a wrong-length or malformed number', () => {
    expect(gstinSchema.safeParse('29ABCDE1234F1Z').success).toBe(false)
    expect(gstinSchema.safeParse('ABCDE12345678Z9').success).toBe(false)
  })

  it('is optional — most walk-in customers have none', () => {
    expect(gstinSchema.safeParse('').success).toBe(true)
    expect(gstinSchema.safeParse(undefined).success).toBe(true)
  })
})

describe('branch schema', () => {
  it('upper-cases the code', () => {
    const parsed = branchSchema.parse({ code: 'main', name: 'Main Branch' })
    expect(parsed.code).toBe('MAIN')
  })

  it('rejects codes with spaces or punctuation', () => {
    expect(branchSchema.safeParse({ code: 'MAIN BR', name: 'x y' }).success).toBe(false)
    expect(branchSchema.safeParse({ code: 'MAIN!', name: 'x y' }).success).toBe(false)
  })

  it('accepts hyphens and underscores', () => {
    expect(branchSchema.safeParse({ code: 'MG-ROAD_2', name: 'MG Road' }).success).toBe(true)
  })
})

describe('party schema', () => {
  it('requires only a name — a walk-in customer may have nothing else', () => {
    expect(partySchema.safeParse({ name: 'Cash Customer' }).success).toBe(true)
  })

  it('rejects a malformed phone', () => {
    expect(partySchema.safeParse({ name: 'A B', phone: 'not-a-phone' }).success).toBe(false)
  })

  it('accepts common Indian phone formats', () => {
    for (const phone of ['9876543210', '+91 98765 43210', '080-2222 3333']) {
      expect(partySchema.safeParse({ name: 'A B', phone }).success, phone).toBe(true)
    }
  })
})

describe('business profile', () => {
  it('defaults to INR and tax-inclusive pricing', () => {
    const parsed = businessProfileSchema.parse({ name: 'ECITY Mobiles' })
    expect(parsed.currency).toBe('INR')
    expect(parsed.pricesIncludeTax).toBe(true)
    expect(parsed.invoicePrefix).toBe('INV')
  })
})
