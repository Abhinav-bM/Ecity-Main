import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Page controls for a server-rendered list.
 *
 * Every list service already returns `total` and takes `page`, but without a
 * control on the screen a list silently stops at the first page — which looks
 * like "that is all the data" rather than "there is more". So this always
 * states the range and the total, even when there is only one page.
 *
 * Paging is a plain link, not client state: the page number lives in the URL
 * alongside the filters, so it survives a reload, a back button and being
 * pasted to someone else.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
  noun = 'rows',
}: {
  basePath: string
  /** The screen's current search params. Filters are carried across pages. */
  params: Record<string, string | string[] | undefined>
  page: number
  pageSize: number
  total: number
  noun?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)

  const href = (target: number) => {
    const q = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (key === 'page' || value == null) continue
      const v = Array.isArray(value) ? value[0] : value
      if (v) q.set(key, v)
    }
    // Page 1 is the bare URL, so the first page has one canonical address.
    if (target > 1) q.set('page', String(target))
    const query = q.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  const first = total === 0 ? 0 : (current - 1) * pageSize + 1
  const last = Math.min(current * pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      data-testid="pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0 ? (
          `No ${noun}`
        ) : (
          <>
            Showing <span className="tabular">{first.toLocaleString('en-IN')}</span>–
            <span className="tabular">{last.toLocaleString('en-IN')}</span> of{' '}
            <span className="tabular font-medium text-foreground">
              {total.toLocaleString('en-IN')}
            </span>{' '}
            {noun}
          </>
        )}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-2">
          <span className="hidden text-muted-foreground sm:inline">
            Page {current} of {pages}
          </span>
          {/*
            An <a> ignores the disabled attribute, so an edge page renders a
            real disabled <button> instead of a link that would navigate to
            page 0 or past the end.
          */}
          {current <= 1 ? (
            <Button size="lg" variant="outline" disabled>
              <ChevronLeft className="size-4" />
              Previous
            </Button>
          ) : (
            <Button size="lg" variant="outline" asChild>
              <Link href={href(current - 1)} rel="prev">
                <ChevronLeft className="size-4" />
                Previous
              </Link>
            </Button>
          )}
          {current >= pages ? (
            <Button size="lg" variant="outline" disabled>
              Next
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button size="lg" variant="outline" asChild>
              <Link href={href(current + 1)} rel="next">
                Next
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          )}
        </div>
      ) : null}
    </nav>
  )
}
