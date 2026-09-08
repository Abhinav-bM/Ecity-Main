/**
 * Reading a list screen's page and sort out of the URL.
 *
 * The page number and the sort live in the address bar, next to the filters,
 * for the same reason paging does (see `<Pagination>`): a sorted, paged view
 * survives a reload and a back button, and can be pasted to someone else.
 * Client-side sort state cannot do any of that.
 */

export type SortDirection = 'asc' | 'desc'

export type ListView<TKey extends string> = {
  page: number
  sort: TKey
  dir: SortDirection
}

/**
 * Parse `page`, `sort` and `dir`, refusing anything the screen did not offer.
 *
 * `allowed` is the whitelist, and an unknown key falls back to the default
 * rather than reaching a query builder - a sort key from the URL is user
 * input, and one that reached SQL unchecked is how an ORDER BY becomes an
 * injection point.
 */
export function readListView<TKey extends string>(
  params: Record<string, string | string[] | undefined>,
  allowed: readonly TKey[],
  fallback: { sort: TKey; dir?: SortDirection },
): ListView<TKey> {
  const one = (key: string) => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  const asked = one('sort')
  const sort = allowed.includes(asked as TKey) ? (asked as TKey) : fallback.sort
  const dir: SortDirection = one('dir') === 'desc' ? 'desc' : one('dir') === 'asc' ? 'asc' : (fallback.dir ?? 'asc')

  return { page: Math.max(1, Number(one('page') ?? '1') || 1), sort, dir }
}

/**
 * Sort and cut a list that was fetched whole.
 *
 * Used by the screens whose lists are *bounded by the business* - one row per
 * employee, per role, per branch. Those are tens of rows, and every picker in
 * the app already reads the same functions expecting all of them, so paging
 * them in the database would buy nothing and fork the query. A list that
 * grows with trade - stock, sales, low stock - pages in SQL instead.
 */
export function sortAndPage<T>(
  rows: T[],
  view: { page: number; dir: SortDirection },
  pageSize: number,
  key: (row: T) => string | number | Date | null | undefined,
): { rows: T[]; total: number } {
  const sorted = [...rows].sort((a, b) => {
    const left = key(a)
    const right = key(b)
    // Empty last whichever way the column is pointing: a blank is not a value,
    // and burying the filled rows under blanks is never what was wanted.
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1

    const compared =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, undefined, { sensitivity: 'base' })
        : Number(left) - Number(right)
    return view.dir === 'desc' ? -compared : compared
  })

  const start = (view.page - 1) * pageSize
  return { rows: sorted.slice(start, start + pageSize), total: rows.length }
}
