import { describe, expect, it } from 'vitest'
import { describeChange, describeChanges, fieldLabel, fieldValue } from '@/lib/changes'

/**
 * The audit log is where an owner answers "who changed this price?". It used
 * to print the raw diff as JSON, which does not answer it.
 */
describe('field labels', () => {
  it('drops the storage suffixes, which are an implementation detail', () => {
    expect(fieldLabel('sellingPricePaise')).toBe('Selling price')
    expect(fieldLabel('rateBasisPoints')).toBe('Rate')
    expect(fieldLabel('categoryId')).toBe('Category')
  })

  it('splits camel case into words', () => {
    expect(fieldLabel('addressLine1')).toBe('Address line 1')
    expect(fieldLabel('warrantyMonths')).toBe('Warranty months')
  })

  it('keeps the names people actually use', () => {
    expect(fieldLabel('gstin')).toBe('GSTIN')
    expect(fieldLabel('isNewCut')).toBe('NEW CUT')
    expect(fieldLabel('imeiSlots')).toBe('IMEI fields per device')
  })
})

describe('field values', () => {
  it('shows money as money, not as paise', () => {
    // 1400000 paise is ₹14,000 — the number in the database is not the number
    // on the shelf.
    expect(fieldValue('sellingPricePaise', 1400000)).toMatch(/14,000/)
  })

  it('shows a tax rate as a percentage, not as basis points', () => {
    expect(fieldValue('rateBasisPoints', 1800)).toBe('18%')
  })

  it('says yes and no rather than true and false', () => {
    expect(fieldValue('isActive', true)).toBe('yes')
    expect(fieldValue('gstEnabled', false)).toBe('no')
  })

  it('spells database enums the way people do', () => {
    expect(fieldValue('status', 'IN_STOCK')).toBe('in stock')
    expect(fieldValue('salesChannel', 'EXTERNAL')).toBe('external')
  })

  it('shows a list, and says so when it is empty', () => {
    expect(fieldValue('branchIds', [1, 2])).toBe('1, 2')
    expect(fieldValue('branchIds', [])).toBe('none')
  })

  it('shows a date, not a timestamp', () => {
    expect(fieldValue('purchaseDate', '2026-09-09T07:56:00.000Z')).toBe('2026-09-09')
  })

  it('shows an em dash for nothing at all', () => {
    expect(fieldValue('phone', null)).toBe('—')
    expect(fieldValue('phone', '')).toBe('—')
  })
})

describe('describing a change', () => {
  it('says "set to" for a create, not "changed from nothing"', () => {
    expect(describeChange('name', { from: null, to: 'Ravi Kumar' })).toBe(
      'Name set to Ravi Kumar',
    )
  })

  it('says what a cleared field used to be', () => {
    // Otherwise the log records that something vanished without saying what.
    expect(describeChange('phone', { from: '9876543210', to: null })).toBe(
      'Phone cleared (was 9876543210)',
    )
  })

  it('shows both sides of a real edit', () => {
    expect(describeChange('sellingPricePaise', { from: 1200000, to: 1400000 })).toMatch(
      /Selling price: ₹12,000.*→.*₹14,000/,
    )
  })

  it('orders the lines by label, so the same edit always reads the same way', () => {
    const lines = describeChanges({
      phone: { from: null, to: '900' },
      name: { from: null, to: 'A' },
      city: { from: null, to: 'Kochi' },
    })
    expect(lines).toEqual(['City set to Kochi', 'Name set to A', 'Phone set to 900'])
  })

  it('has nothing to say about nothing', () => {
    expect(describeChanges(null)).toEqual([])
    expect(describeChanges({})).toEqual([])
  })
})
