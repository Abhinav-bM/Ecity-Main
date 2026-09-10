import { describe, expect, it } from 'vitest'
import { WARRANTY_PROVIDERS, warrantyProviderLabel } from '@/lib/warranty'

describe('warranty provider', () => {
  it('is stored as UPPER_SNAKE codes, like every other coded value here', () => {
    for (const { value } of WARRANTY_PROVIDERS) {
      expect(value, `${value} should be an UPPER_SNAKE code`).toMatch(/^[A-Z][A-Z_]*$/)
    }
    expect(WARRANTY_PROVIDERS.map((p) => p.value)).toEqual(['BRAND_WARRANTY', 'SHOP_WARRANTY'])
  })

  it('renders a code as English', () => {
    expect(warrantyProviderLabel('BRAND_WARRANTY')).toBe('Brand warranty')
    expect(warrantyProviderLabel('SHOP_WARRANTY')).toBe('Shop warranty')
  })

  /*
   * The column was free text for a long time, and the importer fills it from
   * whatever a shop's spreadsheet said. Those rows must still read as they
   * were recorded rather than being blanked or shown as a code they never had.
   */
  it('passes older free-text values through untouched', () => {
    expect(warrantyProviderLabel('Brand India')).toBe('Brand India')
    expect(warrantyProviderLabel('Local shop')).toBe('Local shop')
  })

  it('has nothing to say about nothing', () => {
    expect(warrantyProviderLabel(null)).toBeNull()
    expect(warrantyProviderLabel(undefined)).toBeNull()
    expect(warrantyProviderLabel('')).toBeNull()
  })
})
