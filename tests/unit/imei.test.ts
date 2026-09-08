import { describe, expect, it } from 'vitest'
import { looksLikeImei } from '@/components/barcode-scanner'

/**
 * The camera's confidence check.
 *
 * An IMEI label sits beside a near-identical serial barcode, and putting the
 * wrong handset on a bill is worse than a slow scan. IMEIs end in a Luhn
 * check digit, so most misreads are detectable — a scan that passes is acted
 * on, one that fails is shown to a person instead.
 */
describe('looksLikeImei', () => {
  it('accepts real IMEIs', () => {
    // Published test IMEIs, each with a valid check digit.
    for (const imei of ['490154203237518', '356938035643809', '861234567890127']) {
      expect(looksLikeImei(imei), imei).toBe(true)
    }
  })

  it('rejects one wrong digit — the misread that matters', () => {
    // 490154203237518 is valid; changing one digit must not pass.
    expect(looksLikeImei('490154203237519')).toBe(false)
    expect(looksLikeImei('490154203237618')).toBe(false)
  })

  it('rejects anything that is not fifteen digits', () => {
    expect(looksLikeImei('49015420323751')).toBe(false)
    expect(looksLikeImei('4901542032375180')).toBe(false)
    expect(looksLikeImei('')).toBe(false)
  })

  it('ignores spaces and hyphens, which labels print and scanners emit', () => {
    expect(looksLikeImei('49-015420-323751-8')).toBe(true)
    expect(looksLikeImei(' 490154203237518 ')).toBe(true)
  })

  it('rejects a serial that merely contains fifteen digits', () => {
    /*
     * The barcode next to the one they meant. Stripping every non-digit
     * would have found a valid IMEI inside this and accepted it.
     */
    expect(looksLikeImei('SN490154203237518X')).toBe(false)
    expect(looksLikeImei('490154203237518A')).toBe(false)
  })
})
