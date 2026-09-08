'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

const AREAS = [
  ['', 'Overview'],
  ['insights', 'Insights'],
  ['sales', 'Sales'],
  ['products', 'Products'],
  ['brands', 'Brands'],
  ['customers', 'Customers'],
  ['credit', 'Credit'],
  ['inventory', 'Inventory'],
  ['profit', 'Profit'],
  ['payments', 'Payments'],
  ['suppliers', 'Suppliers'],
] as const

/** Keeps the date range and branch when moving between areas. */
export function AnalyticsTabs({ canSeeProfit }: { canSeeProfit: boolean }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const query = params.toString()

  return (
    <nav
      aria-label="Analytics areas"
      className="flex gap-1 overflow-x-auto border-b pb-px"
      data-testid="analytics-tabs"
    >
      {AREAS.filter(([slug]) => canSeeProfit || slug !== 'profit').map(([slug, label]) => {
        const href = `/analytics${slug ? `/${slug}` : ''}`
        const active = pathname === href
        return (
          <Link
            key={slug}
            href={query ? `${href}?${query}` : href}
            className={cn(
              'shrink-0 rounded-t-md border-b-2 px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
