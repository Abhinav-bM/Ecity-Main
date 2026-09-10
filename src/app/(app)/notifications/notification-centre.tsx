'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bell, BellOff, Check, Info, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field } from '@/components/form-field'
import { formatDateTime } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

type Item = {
  id: number
  kind: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  title: string
  body: string
  href: string | null
  branchId: number | null
  branchName: string | null
  createdAt: string
  resolvedAt: Date | null
  isRead: boolean
}

type Rule = {
  kind: string
  label: string
  description: string
  isEnabled: boolean
  thresholdDays: number | null
  thresholdPaise: string | null
  mutedForMe: boolean
}

const ICON = {
  INFO: Info,
  WARNING: TriangleAlert,
  CRITICAL: AlertTriangle,
} as const

/**
 * The notification centre (PRD FR-27.3).
 *
 * In-app only in v1 — email and WhatsApp are OQ-6, and a channel that leaves
 * the building is a decision about cost and consent, not a screen.
 */
export function NotificationCentre({
  items,
  rules,
  showAll,
  canManage,
  groupByBranch,
}: {
  items: Item[]
  rules: Rule[]
  showAll: boolean
  canManage: boolean
  groupByBranch: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function post(body: unknown, done?: string) {
    setBusy(true)
    try {
      const res = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (done) toast.success(done)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  /*
   * The owner sees every branch, so an ungrouped wall of alerts would make it
   * impossible to tell which shop has the problem. A branch user sees one
   * branch and needs no headings.
   */
  const groups = groupByBranch
    ? [...new Map(items.map((i) => [i.branchName ?? 'Whole business', i])).keys()].sort()
    : []

  const unread = items.filter((i) => !i.isRead).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            What needs attention, for the branches you can see.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => post({ action: 'evaluate' }, 'Checked.')}
          >
            <RefreshCw className="size-4" /> Check now
          </Button>
          {unread > 0 ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => post({ action: 'readAll' }, 'Marked as read.')}
            >
              <Check className="size-4" /> Mark all read
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">
            Alerts
            {unread > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {unread}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="settings">What you are told about</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4 space-y-4">
          <div className="flex gap-2 text-sm">
            <Link
              href="/notifications"
              className={showAll ? 'text-muted-foreground underline-offset-4 hover:underline' : 'font-medium'}
            >
              Needs attention
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              href="/notifications?show=all"
              className={showAll ? 'font-medium' : 'text-muted-foreground underline-offset-4 hover:underline'}
            >
              Everything, including dealt with
            </Link>
          </div>

          {items.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bell className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Nothing needs attention.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Low stock, overdue money, an unclosed day — they appear here as they happen.
                </p>
              </CardContent>
            </Card>
          ) : groupByBranch ? (
            groups.map((group) => (
              <div key={group} className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">{group}</h2>
                <div className="space-y-2">
                  {items
                    .filter((i) => (i.branchName ?? 'Whole business') === group)
                    .map((item) => (
                      <Row key={item.id} item={item} busy={busy} onRead={post} />
                    ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <Row key={item.id} item={item} busy={busy} onRead={post} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-3">
          {rules.map((rule) => (
            <RuleCard key={rule.kind} rule={rule} canManage={canManage} />
          ))}
          <p className="text-xs text-muted-foreground">
            Muting affects your bell only. Turning one off for the shop
            {canManage ? ' clears the alerts it had already raised.' : ' needs permission.'}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Row({
  item,
  busy,
  onRead,
}: {
  item: Item
  busy: boolean
  onRead: (body: unknown, done?: string) => Promise<void>
}) {
  const Icon = ICON[item.severity]
  const tone =
    item.severity === 'CRITICAL'
      ? 'text-destructive'
      : item.severity === 'WARNING'
        ? 'text-amber-600 dark:text-amber-500'
        : 'text-muted-foreground'

  return (
    <Card data-testid="notification" data-read={item.isRead ? 'true' : 'false'}>
      <CardContent className="flex flex-wrap items-start gap-3 py-3">
        <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {item.href ? (
              <Link href={item.href} className="underline-offset-4 hover:underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
            {item.resolvedAt ? (
              <Badge variant="muted" className="ml-2">
                dealt with
              </Badge>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">{item.body}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(new Date(item.createdAt))}
            {item.branchName ? ` · ${item.branchName}` : ''}
          </p>
        </div>
        {!item.isRead ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Mark "${item.title}" as read`}
            onClick={() => onRead({ action: 'read', ids: [item.id] })}
          >
            <Check className="size-4" />
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RuleCard({ rule, canManage }: { rule: Rule; canManage: boolean }) {
  const router = useRouter()
  const [days, setDays] = useState(rule.thresholdDays?.toString() ?? '')
  const [busy, setBusy] = useState(false)

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await apiFetch('/api/notifications/rules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: rule.kind, ...body }),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="rule-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">{rule.label}</CardTitle>
          <p className="text-xs text-muted-foreground">{rule.description}</p>
        </div>
        <Button
          variant={rule.mutedForMe ? 'secondary' : 'ghost'}
          size="sm"
          disabled={busy}
          aria-label={`${rule.mutedForMe ? 'Unmute' : 'Mute'} ${rule.label} for me`}
          onClick={() => patch({ mutedForMe: !rule.mutedForMe })}
        >
          {rule.mutedForMe ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {rule.mutedForMe ? 'Muted' : 'Mute'}
        </Button>
      </CardHeader>
      {canManage ? (
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button
            variant={rule.isEnabled ? 'outline' : 'secondary'}
            size="sm"
            disabled={busy}
            onClick={() => patch({ isEnabled: !rule.isEnabled, thresholdDays: rule.thresholdDays })}
          >
            {rule.isEnabled ? 'On for the shop' : 'Off for the shop'}
          </Button>
          {rule.thresholdDays !== null ? (
            <Field id={`days-${rule.kind}`} label="After how many days" className="w-40">
              <Input
                id={`days-${rule.kind}`}
                inputMode="numeric"
                value={days}
                disabled={busy}
                onChange={(e) => setDays(e.target.value)}
                onBlur={() =>
                  days !== (rule.thresholdDays?.toString() ?? '') &&
                  patch({ isEnabled: rule.isEnabled, thresholdDays: Number(days) || 0 })
                }
              />
            </Field>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
