'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/app-select'

/** Branch and date pickers. Both live in the URL so a view can be shared. */
export function DrawerControls({
  branches,
  branchId,
  date,
  basePath = '/cash',
}: {
  branches: { id: number; name: string }[]
  branchId: number
  date: string
  basePath?: string
}) {
  const router = useRouter()
  const params = useSearchParams()

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) q.set(k, v)
    router.push(`${basePath}?${q.toString()}`)
  }

  return (
    <Card>
      <CardContent className="grid gap-3 py-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="drawer-branch">Branch</Label>
          <AppSelect
            id="drawer-branch"
            label="Branch"
            value={String(branchId)}
            onValueChange={(v) => go({ branchId: v })}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drawer-date">Date</Label>
          <Input
            id="drawer-date"
            type="date"
            value={date}
            onChange={(e) => go({ date: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  )
}
