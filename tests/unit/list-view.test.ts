import { describe, expect, it } from 'vitest'
import { readListView, sortAndPage } from '@/lib/list-view'

/**
 * The page and the sort come out of the URL, which means they are user input.
 * These are the rules that keep that safe and predictable.
 */
describe('reading a list view from the URL', () => {
  const columns = ['name', 'email'] as const

  it('falls back when the sort key is not one the screen offers', () => {
    // A key from the URL must never reach an ORDER BY unchecked.
    const view = readListView({ sort: 'password; drop table' }, columns, { sort: 'name' })
    expect(view.sort).toBe('name')
  })

  it('takes a key the screen does offer', () => {
    expect(readListView({ sort: 'email' }, columns, { sort: 'name' }).sort).toBe('email')
  })

  it('defaults the direction, and honours an explicit one', () => {
    expect(readListView({}, columns, { sort: 'name' }).dir).toBe('asc')
    expect(readListView({}, columns, { sort: 'name', dir: 'desc' }).dir).toBe('desc')
    expect(readListView({ dir: 'asc' }, columns, { sort: 'name', dir: 'desc' }).dir).toBe('asc')
    // Anything else is not a direction.
    expect(readListView({ dir: 'sideways' }, columns, { sort: 'name' }).dir).toBe('asc')
  })

  it('never returns a page below 1, whatever the URL says', () => {
    for (const page of ['0', '-3', 'banana', '']) {
      expect(readListView({ page }, columns, { sort: 'name' }).page).toBe(1)
    }
    expect(readListView({ page: '4' }, columns, { sort: 'name' }).page).toBe(4)
  })
})

describe('sorting and paging a bounded list', () => {
  const rows = [
    { name: 'Zoya', seats: 3 },
    { name: 'aaron', seats: 10 },
    { name: 'Meera', seats: 1 },
  ]

  it('sorts text case-insensitively, so a lowercase name is not exiled', () => {
    const { rows: out } = sortAndPage(rows, { page: 1, dir: 'asc' }, 10, (r) => r.name)
    expect(out.map((r) => r.name)).toEqual(['aaron', 'Meera', 'Zoya'])
  })

  it('sorts numbers as numbers, not as text', () => {
    const { rows: out } = sortAndPage(rows, { page: 1, dir: 'desc' }, 10, (r) => r.seats)
    expect(out.map((r) => r.seats)).toEqual([10, 3, 1])
  })

  it('puts blanks last whichever way the column points', () => {
    const withGaps = [{ city: 'Kochi' }, { city: null }, { city: 'Alappuzha' }]
    for (const dir of ['asc', 'desc'] as const) {
      const { rows: out } = sortAndPage(withGaps, { page: 1, dir }, 10, (r) => r.city)
      // A blank is not a value; burying the filled rows under it helps nobody.
      expect(out[out.length - 1]!.city).toBeNull()
    }
  })

  it('cuts the page but reports the whole total', () => {
    const { rows: out, total } = sortAndPage(rows, { page: 2, dir: 'asc' }, 2, (r) => r.name)
    expect(total).toBe(3)
    expect(out.map((r) => r.name)).toEqual(['Zoya'])
  })

  it('returns nothing for a page past the end, rather than the last page', () => {
    // Silently showing page 3 as page 9 would make the control lie.
    const { rows: out } = sortAndPage(rows, { page: 9, dir: 'asc' }, 2, (r) => r.name)
    expect(out).toHaveLength(0)
  })
})
