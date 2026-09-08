import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * A column heading that sorts, as a link.
 *
 * Server-rendered and URL-driven, like the pagination beside it: the sort
 * survives a reload and travels when the address is shared. It also means a
 * sorted page is a *server* render of the right rows, so sorting a list does
 * not silently mean "sort the page you can see" - the trap with client-side
 * sorting over a paged table, where the answer is confidently wrong.
 *
 * Clicking the active column flips the direction; clicking another starts it
 * ascending, which is what every table people already use does.
 */
export function SortableHead({
  basePath,
  params,
  column,
  label,
  active,
  dir,
  align = 'left',
  className,
}: {
  basePath: string
  params: Record<string, string | string[] | undefined>
  column: string
  label: string
  active: string
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = active === column
  const next = isActive && dir === 'asc' ? 'desc' : 'asc'

  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // A new sort starts at the first page: staying on page 7 of a re-ordered
    // list shows a stranger's rows.
    if (key === 'page' || key === 'sort' || key === 'dir' || value == null) continue
    const v = Array.isArray(value) ? value[0] : value
    if (v) q.set(key, v)
  }
  q.set('sort', column)
  q.set('dir', next)

  const Icon = !isActive ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown

  return (
    <TableHead className={cn(align === 'right' && 'text-right', className)}>
      <Link
        href={`${basePath}?${q.toString()}`}
        aria-label={`Sort by ${label}, ${next}ending`}
        className={cn(
          'inline-flex items-center gap-1 underline-offset-4 hover:underline',
          align === 'right' && 'flex-row-reverse',
          isActive && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-3.5', isActive ? 'opacity-100' : 'opacity-40')} />
      </Link>
    </TableHead>
  )
}

/**
 * The same sorting, for the card layout a phone gets.
 *
 * The tables are hidden below `md`, so column headings alone would mean
 * sorting simply does not exist on a phone — on an app whose smallest tested
 * screen is 320px and whose owner checks stock from the shop floor. A strip
 * of the same links, scrollable sideways, keeps it available without pushing
 * a table onto a screen too narrow for one.
 */
export function SortStrip({
  basePath,
  params,
  columns,
  active,
  dir,
  className,
}: {
  basePath: string
  params: Record<string, string | string[] | undefined>
  columns: readonly (readonly [string, string])[]
  active: string
  dir: 'asc' | 'desc'
  className?: string
}) {
  return (
    <div
      className={cn('-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1', className)}
      data-testid="sort-strip"
    >
      <span className="shrink-0 self-center pr-1 text-xs text-muted-foreground">Sort</span>
      {columns.map(([column, label]) => {
        const isActive = active === column
        const next = isActive && dir === 'asc' ? 'desc' : 'asc'

        const q = new URLSearchParams()
        for (const [key, value] of Object.entries(params)) {
          if (key === 'page' || key === 'sort' || key === 'dir' || value == null) continue
          const v = Array.isArray(value) ? value[0] : value
          if (v) q.set(key, v)
        }
        q.set('sort', column)
        q.set('dir', next)

        const Icon = !isActive ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown

        return (
          <Link
            key={column}
            href={`${basePath}?${q.toString()}`}
            aria-label={`Sort by ${label}, ${next}ending`}
            className={cn(
              'inline-flex shrink-0 snap-start items-center gap-1 rounded-md border px-2 py-1 text-xs',
              isActive ? 'bg-primary text-primary-foreground' : 'bg-background',
            )}
          >
            {label}
            <Icon className="size-3" />
          </Link>
        )
      })}
    </div>
  )
}
