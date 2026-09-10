'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { apiFetch } from '@/lib/api'

type Role = {
  id: number
  code: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: string[]
}

type Permission = { code: string; group: string; label: string; description: string | null }

export function RoleEditor({
  roles,
  permissions,
}: {
  roles: Role[]
  permissions: Permission[]
}) {
  const router = useRouter()
  const [activeId, setActiveId] = useState<number | null>(roles[0]?.id ?? null)
  const [draft, setDraft] = useState<Set<string>>(new Set(roles[0]?.permissions ?? []))
  const [saving, setSaving] = useState(false)

  const active = roles.find((r) => r.id === activeId) ?? null

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of permissions) {
      const list = map.get(p.group) ?? []
      list.push(p)
      map.set(p.group, list)
    }
    return [...map.entries()]
  }, [permissions])

  const dirty = useMemo(() => {
    if (!active) return false
    const current = new Set(active.permissions)
    if (current.size !== draft.size) return true
    for (const c of current) if (!draft.has(c)) return true
    return false
  }, [active, draft])

  function selectRole(role: Role) {
    setActiveId(role.id)
    setDraft(new Set(role.permissions))
  }

  function toggle(code: string, on: boolean) {
    const next = new Set(draft)
    if (on) next.add(code)
    else next.delete(code)
    setDraft(next)
  }

  async function save() {
    if (!active) return
    setSaving(true)
    const res = await apiFetch(`/api/roles/${active.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissions: [...draft] }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Role updated. Affected users will be signed out.')
    router.refresh()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr] lg:items-start">
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Roles</CardTitle>
        </CardHeader>
        {/* A horizontal strip on small screens, a list once there is a column. */}
        <CardContent className="flex snap-x gap-2 overflow-x-auto p-2 lg:flex-col lg:gap-1 lg:overflow-visible">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => selectRole(r)}
              className={`min-w-[10rem] shrink-0 snap-start rounded-md px-3 py-2 text-left text-sm transition-colors lg:w-full lg:min-w-0 ${
                r.id === activeId ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              <span className="block font-medium">{r.name}</span>
              <span className="block text-xs opacity-70">{r.permissions.length} permissions</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {active ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                {active.name}
                {active.isSystem ? <Badge variant="muted">System</Badge> : null}
              </CardTitle>
              <CardDescription>{active.description}</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="w-full sm:w-auto"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {grouped.map(([group, items]) => (
              <div key={group} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <div className="space-y-2">
                  {items.map((p) => (
                    <label key={p.code} className="flex cursor-pointer items-start gap-2.5 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={draft.has(p.code)}
                        onCheckedChange={(c) => toggle(p.code, c === true)}
                      />
                      <span>
                        <span className="block">{p.label}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {p.code}
                        </span>
                        {p.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {p.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
