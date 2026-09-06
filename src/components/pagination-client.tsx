'use client'

import { useSearchParams } from 'next/navigation'
import { Pagination } from '@/components/pagination'

/**
 * Pagination for lists whose filters live in a client component.
 *
 * Same control, but it reads the current query string itself so the caller
 * does not have to thread search params down through the list.
 */
export function ClientPagination(props: {
  basePath: string
  page: number
  pageSize: number
  total: number
  noun?: string
}) {
  const searchParams = useSearchParams()
  return <Pagination {...props} params={Object.fromEntries(searchParams.entries())} />
}
