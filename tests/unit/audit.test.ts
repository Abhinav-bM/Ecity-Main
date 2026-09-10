import { describe, expect, it } from 'vitest'
import { diff } from '@/server/db/audit'

describe('audit diff', () => {
  it('records only changed fields', () => {
    const before = { name: 'Old', email: 'a@b.c', isActive: true }
    expect(diff(before, { name: 'New', email: 'a@b.c' })).toEqual({
      name: { from: 'Old', to: 'New' },
    })
  })

  it('treats a create as all-new', () => {
    expect(diff(null, { name: 'New' })).toEqual({ name: { from: null, to: 'New' } })
  })

  it('never records the password hash', () => {
    const changes = diff({ passwordHash: 'old', name: 'a' }, { passwordHash: 'new', name: 'x' })
    expect(changes).not.toHaveProperty('passwordHash')
    expect(changes).toHaveProperty('name')
  })

  it('ignores bookkeeping timestamps', () => {
    const before = { updatedAt: new Date('2020-01-01'), name: 'a' }
    expect(diff(before, { updatedAt: new Date('2026-01-01') })).toEqual({})
  })

  it('compares dates by value, not identity', () => {
    const d1 = new Date('2026-01-01')
    const d2 = new Date('2026-01-01')
    expect(diff({ at: d1 }, { at: d2 })).toEqual({})
  })

  it('compares arrays structurally, so branch lists diff correctly', () => {
    expect(diff({ branchIds: [1, 2] }, { branchIds: [1, 2] })).toEqual({})
    expect(diff({ branchIds: [1] }, { branchIds: [1, 2] })).toEqual({
      branchIds: { from: [1], to: [1, 2] },
    })
  })
})

describe('absent and empty are the same thing', () => {
  it('does not record a field that was never set and still is not', () => {
    /*
     * A create passes the whole record, so a customer with no email arrives
     * as `email: null` against nothing at all. Recording that filled the
     * audit log with "null -> null" and pushed the real change off screen.
     */
    expect(diff(null, { name: 'New', email: null, phone: null })).toEqual({
      name: { from: null, to: 'New' },
    })
  })

  it('still records clearing a value that was there', () => {
    const before: Record<string, unknown> = { phone: '9876543210' }
    expect(diff(before, { phone: null })).toEqual({
      phone: { from: '9876543210', to: null },
    })
  })

  it('treats undefined and null as equal, whichever side they are on', () => {
    const undef: Record<string, unknown> = { email: undefined }
    const nul: Record<string, unknown> = { email: null }
    expect(diff(undef, { email: null })).toEqual({})
    expect(diff(nul, { email: undefined })).toEqual({})
  })
})

describe('diff with money in it', () => {
  /*
   * Money is bigint paise everywhere, and both the comparison inside `diff`
   * and the jsonb column it is written to go through JSON.stringify, which
   * throws on a bigint. A price change is the most ordinary thing an audit log
   * has to record, so it must not be the thing that breaks the write.
   */
  it('records a changed price instead of throwing', () => {
    const changes = diff({ sellingPricePaise: 100_000n }, { sellingPricePaise: 125_000n })
    expect(changes.sellingPricePaise).toEqual({ from: '100000', to: '125000' })
  })

  it('sees two equal amounts as unchanged', () => {
    expect(diff({ pricePaise: 4_999n }, { pricePaise: 4_999n })).toEqual({})
  })

  it('handles a price being set for the first time', () => {
    const before: { pricePaise: bigint | null } = { pricePaise: null }
    expect(diff(before, { pricePaise: 7_500n })).toEqual({
      pricePaise: { from: null, to: '7500' },
    })
  })

  it('keeps full precision, which a number would not', () => {
    const huge = 9_007_199_254_740_993n // Number.MAX_SAFE_INTEGER + 2
    expect(diff({ p: 0n }, { p: huge }).p).toEqual({ from: '0', to: huge.toString() })
  })

  it('reaches money nested inside a value', () => {
    const changes = diff({ totals: { taxPaise: 0n } }, { totals: { taxPaise: 180n } })
    expect(changes.totals).toEqual({ from: { taxPaise: '0' }, to: { taxPaise: '180' } })
  })
})
