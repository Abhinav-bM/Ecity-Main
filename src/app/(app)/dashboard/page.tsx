import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Bell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { getSessionContext } from '@/server/auth/session'
import { unreadCount } from '@/server/services/notification.service'
import { hasPermission } from '@/server/auth/permissions'
import { dashboard } from '@/server/services/dashboard.service'

export const dynamic = 'force-dynamic'

/**
 * PRD FR-15.1 – FR-15.3. Today, at a glance.
 *
 * Everything here is the analytics query layer with the range set to today,
 * so this page and the sales analytics cannot disagree about what today did.
 * The branch shown follows the header's branch switcher.
 */
export default async function DashboardPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const branchIds = session.activeBranchId ? [session.activeBranchId] : undefined
  const d = await dashboard(session.user, branchIds)
  const canSeeAnalytics = hasPermission(session.user, 'analytics.view')
  const unread = hasPermission(session.user, 'notification.view')
    ? await unreadCount(session.user)
    : 0

  const figures: { label: string; value: string; href?: string; hint?: string }[] = [
    {
      label: 'Sales today',
      value: formatMoney(d.sales.revenuePaise),
      href: '/sales',
      hint: `${d.sales.orders} bill${d.sales.orders === 1 ? '' : 's'} · ${d.sales.units} item${d.sales.units === 1 ? '' : 's'}`,
    },
    {
      label: 'Purchases today',
      value: formatMoney(d.purchases.valuePaise),
      href: '/purchases',
      hint: `${d.purchases.count} purchase${d.purchases.count === 1 ? '' : 's'}`,
    },
    ...(d.profit
      ? [
          {
            label: 'Estimated profit',
            value: formatMoney(d.profit.netProfitPaise),
            href: '/analytics/profit',
            hint: `${formatMoney(d.profit.grossProfitPaise)} gross · ${formatMoney(d.profit.expensesPaise)} expenses`,
          },
        ]
      : []),
    {
      label: 'Cash in the till',
      value: formatMoney(d.cashPaise),
      href: '/cash',
      hint: 'Expected, from the movements',
    },
    {
      label: 'In accounts',
      value: formatMoney(d.accountsPaise),
      href: '/accounts',
    },
    {
      label: 'Customers owe',
      value: formatMoney(d.customerDuesPaise),
      href: '/customers/dues',
    },
    {
      label: 'Owed to suppliers',
      value: formatMoney(d.supplierDuesPaise),
      href: '/purchases/supplier-dues',
    },
    {
      label: 'Stock value',
      value: formatMoney(d.stock.valuePaise),
      href: '/analytics/inventory',
      hint: `${d.stock.deviceUnits} handsets · ${d.stock.accessoryUnits} accessories`,
    },
    {
      label: 'Returns today',
      value: formatMoney(d.returns.valuePaise),
      href: '/returns',
      hint: `${d.returns.count} return${d.returns.count === 1 ? '' : 's'}`,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Named for the nav item that reaches it, not for what it shows. */}
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Today, {d.date} ·{' '}
            {session.activeBranchId ? 'this branch' : 'every branch you can see'}
          </p>
        </div>
        {canSeeAnalytics ? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/analytics">Analytics</Link>
          </Button>
        ) : null}
      </div>

      {/*
        FR-15.3 and FR-27. Two different questions, deliberately both here.
        These cards count conditions — "3 products below minimum" — and are
        computed live, so they are right even if the worker has not run. The
        line beneath goes to the alert centre, which names *which* three and
        remembers whether anyone dealt with them.
      */}
      {unread > 0 ? (
        <Link href="/notifications" className="block" data-testid="dashboard-alert-link">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="flex items-center gap-3 py-3 text-sm">
              <Bell className="size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">
                  {unread} alert{unread === 1 ? '' : 's'} you have not looked at
                </span>
                <span className="block text-xs text-muted-foreground">
                  Which product, which bill, which day — and whether it has been dealt with.
                </span>
              </span>
            </CardContent>
          </Card>
        </Link>
      ) : null}

      {d.alerts.length > 0 ? (
        <div className="grid gap-2" data-testid="dashboard-alerts">
          {d.alerts.map((a) => (
            <Link key={a.kind} href={a.href}>
              <Card className="border-warning transition-colors hover:bg-accent">
                <CardContent className="flex items-start gap-3 py-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}

      {/*
        FR-36.4. Every figure is a link: Business → Branch → Transaction →
        Product/IMEI, so a number on this page reaches a handset.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="dashboard-figures">
        {figures.map((f) => (
          <Link key={f.label} href={f.href ?? '#'}>
            <Card className="h-full transition-colors hover:bg-accent">
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="tabular text-xl font-semibold">{f.value}</p>
                {f.hint ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.hint}</p>
                ) : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Getting around</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            ['Bill a customer', '/billing', 'sale.create'],
            ['Record a purchase', '/purchases/new', 'purchase.manage'],
            ['Take a return', '/returns/new', 'return.create'],
            ['Record an expense', '/expenses/new', 'expense.manage'],
            ['Close the day', '/closing', 'closing.create'],
          ].map(([label, href, permission]) =>
            hasPermission(session.user, permission as never) ? (
              <Button key={href} variant="outline" size="sm" asChild>
                <Link href={href!}>{label}</Link>
              </Button>
            ) : null,
          )}
        </CardContent>
      </Card>

      {d.alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Badge variant="success">All clear</Badge> Nothing needs attention: stock is above its
          minimums, no bill is overdue, and every past day has been closed and balanced.
        </p>
      ) : null}
    </div>
  )
}
