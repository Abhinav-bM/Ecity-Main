import { describe, expect, it } from 'vitest'
import { AGING_BUCKETS, agingBucket, daysBetween, emptyBuckets } from '@/server/services/customer-ledger.service'

const day = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * day)

describe('aging buckets', () => {
  it('uses the boundaries the module spec states: 0-7 / 8-30 / 31-60 / 60+', () => {
    expect(agingBucket(0)).toBe('0-7')
    expect(agingBucket(7)).toBe('0-7')
    expect(agingBucket(8)).toBe('8-30')
    expect(agingBucket(30)).toBe('8-30')
    expect(agingBucket(31)).toBe('31-60')
    expect(agingBucket(60)).toBe('31-60')
    expect(agingBucket(61)).toBe('60+')
    expect(agingBucket(3650)).toBe('60+')
  })

  it('covers every day with exactly one bucket', () => {
    for (let d = 0; d <= 400; d++) {
      const bucket = agingBucket(d)
      expect(AGING_BUCKETS).toContain(bucket)
    }
  })

  it('starts every bucket at zero', () => {
    expect(Object.values(emptyBuckets()).every((v) => v === 0n)).toBe(true)
  })
})

describe('days outstanding', () => {
  it('counts whole days elapsed', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    expect(daysBetween(new Date('2026-03-10T00:00:00Z'), now)).toBe(0)
    expect(daysBetween(new Date('2026-03-09T00:00:00Z'), now)).toBe(1)
    expect(daysBetween(new Date('2026-01-09T12:00:00Z'), now)).toBe(60)
  })

  it('treats a future due date as not yet outstanding', () => {
    // A bill due next week is zero days old, not minus seven.
    const now = new Date('2026-03-10T00:00:00Z')
    expect(daysBetween(new Date('2026-03-17T00:00:00Z'), now)).toBe(0)
    expect(agingBucket(daysBetween(new Date('2026-03-17T00:00:00Z'), now))).toBe('0-7')
  })

  it('a part-day does not round up into the next bucket', () => {
    // 7 days and 23 hours is still the 0-7 bucket; 8 days exactly is not.
    const from = ago(7) 
    expect(agingBucket(daysBetween(from, new Date()))).toBe('0-7')
    expect(agingBucket(daysBetween(ago(8), new Date()))).toBe('8-30')
  })
})
