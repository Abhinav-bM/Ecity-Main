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
