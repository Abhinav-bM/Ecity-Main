'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/app-select'
import { apiFetch } from '@/lib/api'

export type SavedView = {
  id: number
  name: string
  report: string
  filters: { from?: string; to?: string; branchId?: string }
  isShared: boolean
  isMine: boolean
}

const FORMATS = [
  ['csv', 'CSV'],
  ['xlsx', 'Excel'],
  ['pdf', 'PDF'],
] as const

/**
 * Choosing a report and taking it away.
 *
 * The three download buttons are plain links, so the browser handles the file
 * the way it handles any download - no fetch, no blob, no spinner that lies
 * about a stream that is still arriving.
 */
export function ReportControls({
  reports,
  branches,
  report,
  from,
  to,
  branchId,
  saved,
}: {
  reports: { value: string; label: string }[]
  branches: { id: number; name: string }[]
  report: string
  from: string
  to: string
  branchId: string
  saved: SavedView[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')
  const [busy, setBusy] = useState(false)

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    /*
     * Changing a filter re-runs the report on the server, and the URL does not
     * change until it comes back - a heavy report can sit there for seconds
     * looking as though the click did nothing, which is how a report ends up
     * being asked for three times. The transition gives it something to say.
     */
    startTransition(() => router.push(`/reports?${q.toString()}`))
  }

  const exportQuery = new URLSearchParams({ report, from, to })
  if (branchId) exportQuery.set('branchId', branchId)

  /*
   * A saved view keeps the filters, never the figures. Applying one re-runs
   * the report against today's data - a stored result would go stale
   * silently, which is the one thing a report must not do.
   */
  function apply(view: SavedView) {
    const q = new URLSearchParams({ report: view.report })
    if (view.filters.from) q.set('from', view.filters.from)
    if (view.filters.to) q.set('to', view.filters.to)
    if (view.filters.branchId) q.set('branchId', view.filters.branchId)
    startTransition(() => router.push(`/reports?${q.toString()}`))
  }

  async function save() {
    if (!viewName.trim()) return
    setBusy(true)
    try {
      const res = await apiFetch('/api/saved-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: viewName.trim(),
          report,
          filters: { from, to, branchId: branchId || undefined },
        }),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const json = res.data as { replaced?: boolean } | null
      toast.success(json?.replaced ? 'View updated.' : 'View saved.')
      setNaming(false)
      setViewName('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(view: SavedView) {
    const res = await apiFetch(`/api/saved-reports/${view.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  return (
    <Card aria-busy={pending}>
      <CardContent className="space-y-3 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="report">Report</Label>
            <AppSelect
              id="report"
              label="Report"
              value={report}
              onValueChange={(v) => go({ report: v })}
              options={reports}
            />
          </div>
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
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="saved-views">
          {saved.length > 0 ? (
            <span className="text-xs text-muted-foreground">Saved views</span>
          ) : null}
          {saved.map((view) => (
            <span
              key={view.id}
              className="inline-flex items-center rounded-md border bg-background text-xs"
              data-testid="saved-view"
            >
              <button
                type="button"
                className="px-2 py-1 hover:underline"
                onClick={() => apply(view)}
              >
                {view.name}
                {view.isShared && !view.isMine ? (
                  <span className="ml-1 text-muted-foreground">(shared)</span>
                ) : null}
              </button>
              {view.isMine ? (
                <button
                  type="button"
                  aria-label={`Remove the ${view.name} view`}
                  className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(view)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}

          {naming ? (
            <span className="flex items-center gap-2">
              <Input
                aria-label="Name for this view"
                className="h-8 w-44"
                autoFocus
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                  if (e.key === 'Escape') setNaming(false)
                }}
              />
              <Button size="sm" onClick={save} disabled={busy}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
              <Star className="size-4" /> Save this view
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="export-buttons">
          <span className="text-xs text-muted-foreground">
            {pending ? 'Rebuilding…' : 'Download as'}
          </span>
          {FORMATS.map(([format, label]) => (
            <Button key={format} variant="outline" size="sm" asChild>
              <a href={`/api/reports/export?${exportQuery.toString()}&format=${format}`}>
                <Download className="size-4" />
                {label}
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
