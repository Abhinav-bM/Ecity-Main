import { describe, expect, it } from 'vitest'
import {
  GST_STATE_CODES,
  isInterState,
  placeOfSupply,
  splitTax,
  stateCodeFromGstin,
  stateName,
} from '@/lib/gst'

describe('GSTIN state code', () => {
  it('reads the state from the first two digits', () => {
    expect(stateCodeFromGstin('32AAAAA0000A1Z5')).toBe('32')
    expect(stateName('32')).toBe('Kerala')
  })

  it('rejects a code that is not a real state', () => {
    // 99 is not allocated; treating it as a state would put the wrong place
    // of supply on a legal document.
    expect(stateCodeFromGstin('99AAAAA0000A1Z5')).toBeNull()
  })

  it('handles a missing GSTIN', () => {
    expect(stateCodeFromGstin(null)).toBeNull()
    expect(stateCodeFromGstin('')).toBeNull()
    expect(stateName(null)).toBeNull()
  })
})

describe('splitting tax', () => {
  it('halves an even amount into CGST and SGST', () => {
    expect(splitTax(1800n, false)).toEqual({ cgstPaise: 900n, sgstPaise: 900n, igstPaise: 0n })
  })

  it('never invents or loses a paisa on an odd amount', () => {
    const split = splitTax(3n, false)
    expect(split.cgstPaise + split.sgstPaise).toBe(3n)
    expect(split.igstPaise).toBe(0n)
  })

  it('puts the whole amount in IGST across state lines', () => {
    expect(splitTax(1801n, true)).toEqual({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1801n })
  })

  it('always reconstitutes the original tax, for every amount up to a rupee', () => {
    for (let paise = 0n; paise <= 100n; paise++) {
      const intra = splitTax(paise, false)
      expect(intra.cgstPaise + intra.sgstPaise + intra.igstPaise).toBe(paise)
      const inter = splitTax(paise, true)
      expect(inter.cgstPaise + inter.sgstPaise + inter.igstPaise).toBe(paise)
    }
  })

  it('handles zero-rated goods', () => {
    expect(splitTax(0n, false)).toEqual({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n })
  })
})

describe('place of supply', () => {
  it('is the branch state for a walk-in', () => {
    expect(placeOfSupply('32', null)).toBe('32')
    expect(isInterState('32', '32')).toBe(false)
  })

  it('follows a registered customer to their own state', () => {
    expect(placeOfSupply('32', '29')).toBe('29')
    expect(isInterState('32', '29')).toBe(true)
  })

  it('falls back to intra-state when a state is unknown', () => {
    // Guessing IGST on incomplete data would misreport the return.
    expect(isInterState(null, '29')).toBe(false)
    expect(isInterState('32', null)).toBe(false)
  })
})

describe('the state code table', () => {
  it('has no duplicate names and uses two-digit keys', () => {
    const keys = Object.keys(GST_STATE_CODES)
    expect(keys.every((k) => /^\d{2}$/.test(k))).toBe(true)
    expect(new Set(Object.values(GST_STATE_CODES)).size).toBe(keys.length)
  })
})
