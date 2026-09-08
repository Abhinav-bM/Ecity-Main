'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/app-select'
import { shopDateString } from '@/lib/date'

/**
 * The controls every analytics page shares (PRD §6.15): a date range, a branch
 * and a comparison toggle.
 *
 * All three live in the URL rather than component state, so a figure someone
 * is looking at can be sent to somebody else and mean the same thing.
 */
export function RangeControls({
  branches,
  from,
  to,
  branchId,
  compare,
  basePath,
  comparable = true,
}: {
  branches: { id: number; name: string }[]
  from: string
  to: string
  branchId: string
  compare: boolean
  basePath: string
  /**
   * Off for a page whose headline is a position rather than a period - stock
   * on hand has no "compared to last month". Offering a button that changes
   * nothing is worse than not offering it.
   */
  comparable?: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    router.push(`${basePath}?${q.toString()}`)
  }

  /** The presets a shop actually asks for. */
  function preset(days: number) {
    const end = shopDateString()
    const start = new Date(`${end}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - (days - 1))
    go({ from: start.toISOString().slice(0, 10), to: end })
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap gap-2">
          {[
            ['Today', 1],
            ['7 days', 7],
            ['30 days', 30],
            ['90 days', 90],
            ['This year', 365],
          ].map(([label, days]) => (
            <Button key={label} variant="outline" size="sm" onClick={() => preset(days as number)}>
              {label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => go({ from: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => go({ to: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branchId">Branch</Label>
            <AppSelect
              id="branchId"
              label="Branch"
              allowEmpty
              emptyLabel="Every branch"
              placeholder="Every branch"
              value={branchId}
              onValueChange={(v) => go({ branchId: v })}
              options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
          {comparable ? (
            <div className="flex items-end">
              <Button
                variant={compare ? 'default' : 'outline'}
                size="sm"
                onClick={() => go({ compare: compare ? '' : '1' })}
              >
                {compare ? 'Comparing' : 'Compare to previous'}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
