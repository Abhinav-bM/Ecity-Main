import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  branch,
  notification,
  notificationRead,
  notificationRule,
  type notificationKindEnum,
} from '@/server/db/schema'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import type { PermissionCode } from '@/lib/permissions'
import { SHOP_TIME_ZONE } from '@/lib/date'
import { formatPaise } from '@/lib/utils'

/**
 * Notifications (PRD FR-27.1 – FR-27.3).
 *
 * The system tells the shop what needs attention instead of waiting to be
 * asked. Three rules shape this file.
 *
 * **A notification is a condition, not a message to a person.** It is written
 * once, scoped to a branch, and read through the same `branchScope` as every
 * other query - so who sees it is decided when it is read, not when it was
 * written. Fanning rows out per user would freeze the audience at write time,
 * and a transfer or a new hire would leave alerts addressed to nobody.
 *
 * **The same condition does not shout twice.** The evaluator runs on a
 * schedule; without a dedupe key a shop short of cables would be told so every
 * hour until it reordered, and a wall of repeats is how people learn to ignore
 * the bell. A key stays open until the condition clears.
 *
 * **An alert nobody may act on is not shown.** Each kind carries the
 * permission its screen needs, so counter staff are not told about supplier
 * dues they cannot see - which would be both noise and a leak.
 */

export type NotificationKind = (typeof notificationKindEnum)['enumValues'][number]

/** What each kind is, who may see it, and how it behaves by default. */
export const NOTIFICATION_KINDS: Record<
  NotificationKind,
  {
    label: string
    description: string
    permission: PermissionCode
    defaultThresholdDays?: number
    defaultThresholdPaise?: bigint
  }
> = {
  LOW_STOCK: {
    label: 'Low stock',
    description: 'An accessory at or below the minimum set for its branch.',
    permission: 'inventory.view',
  },
  CUSTOMER_OVERDUE: {
    label: 'Customer overdue',
    description: 'A bill still unpaid past its due date.',
    permission: 'customer_payment.view',
    defaultThresholdDays: 7,
  },
  SUPPLIER_DUE: {
    label: 'Supplier due',
    description: 'Money the shop owes a supplier, unpaid for too long.',
    permission: 'supplier_payment.view',
    defaultThresholdDays: 30,
  },
  CASH_MISMATCH: {
    label: 'Cash mismatch',
    description: 'A day closed with counted cash different from expected.',
    permission: 'closing.view',
    defaultThresholdPaise: 10000n,
  },
  UNCLOSED_DAY: {
    label: 'Day not closed',
    description: 'A branch traded and nobody closed the day.',
    permission: 'closing.view',
    defaultThresholdDays: 1,
  },
  STOCK_ADJUSTMENT: {
    label: 'Stock adjusted',
    description: 'Stock was corrected outside the ordinary path.',
    permission: 'adjustment.view',
    defaultThresholdDays: 1,
  },
  WARRANTY_EXPIRY: {
    label: 'Warranty expiring',
    description: 'A handset still in stock whose warranty runs out soon.',
    permission: 'inventory.view',
    defaultThresholdDays: 30,
  },
}

export const ALL_KINDS = Object.keys(NOTIFICATION_KINDS) as NotificationKind[]

/* ------------------------------------------------------------- writing --- */

type Raised = {
  businessId: number
  branchId: number | null
  kind: NotificationKind
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  title: string
  body: string
  href?: string
  entityType?: string
  entityId?: number
  dedupeKey: string
}

/**
 * Write one notification, unless this condition is already open.
 *
 * Returns whether anything was written, which is what makes the evaluator
 * testable: running it twice on an unchanged shop must produce nothing the
 * second time.
 */
export async function raise(input: Raised): Promise<boolean> {
  const open = (
    await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.businessId, input.businessId),
          eq(notification.dedupeKey, input.dedupeKey),
          isNull(notification.resolvedAt),
        ),
      )
      .limit(1)
  )[0]
  if (open) return false

  await db.insert(notification).values({
    businessId: input.businessId,
    branchId: input.branchId,
    kind: input.kind,
    severity: input.severity ?? 'WARNING',
    title: input.title,
    body: input.body,
    href: input.href,
    entityType: input.entityType,
    entityId: input.entityId,
    dedupeKey: input.dedupeKey,
  })
  return true
}

/**
 * Close every open notification of a kind whose condition no longer holds.
 *
 * Without this an alert would sit on the screen after the shop dealt with it,
 * and - worse - the dedupe key would block the *next* genuine occurrence
 * forever. Called with the keys that are still true, so anything else clears.
 */
async function resolveMissing(
  businessId: number,
  kind: NotificationKind,
  stillOpen: string[],
): Promise<number> {
  const rows = await db
    .select({ id: notification.id, dedupeKey: notification.dedupeKey })
    .from(notification)
    .where(
      and(
        eq(notification.businessId, businessId),
        eq(notification.kind, kind),
        isNull(notification.resolvedAt),
      ),
    )

  const gone = rows.filter((r) => !stillOpen.includes(r.dedupeKey)).map((r) => r.id)
  if (gone.length === 0) return 0

  await db
    .update(notification)
    .set({ resolvedAt: new Date() })
    .where(inArray(notification.id, gone))
  return gone.length
}

/* ------------------------------------------------------------ the rules --- */

/** The shop's setting for a kind, falling back to the built-in default. */
async function ruleFor(businessId: number, kind: NotificationKind) {
  const row = (
    await db
      .select()
      .from(notificationRule)
      .where(
        and(
          eq(notificationRule.businessId, businessId),
          isNull(notificationRule.userId),
          eq(notificationRule.kind, kind),
        ),
      )
      .limit(1)
  )[0]

  const defaults = NOTIFICATION_KINDS[kind]
  return {
    isEnabled: row?.isEnabled ?? true,
    thresholdDays: row?.thresholdDays ?? defaults.defaultThresholdDays ?? 0,
    thresholdPaise: row?.thresholdPaise ?? defaults.defaultThresholdPaise ?? 0n,
  }
}

export type EvaluationResult = Record<NotificationKind, { raised: number; resolved: number }>

/**
 * Evaluate every rule for one business (PRD FR-27.1).
 *
 * Runs from the worker on a schedule, and from a button for anyone who wants
 * to know *now*. Every query here is the same one the matching screen uses -
 * a notification that disagreed with the screen it links to would be worse
 * than no notification.
 */
export async function evaluateRules(
  businessId: number,
  now: Date = new Date(),
): Promise<EvaluationResult> {
  const result = Object.fromEntries(
    ALL_KINDS.map((k) => [k, { raised: 0, resolved: 0 }]),
  ) as EvaluationResult

  const branches = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(and(eq(branch.businessId, businessId), eq(branch.status, 'ACTIVE')))
  const branchName = new Map(branches.map((b) => [b.id, b.name]))

  for (const kind of ALL_KINDS) {
    const rule = await ruleFor(businessId, kind)
    if (!rule.isEnabled) {
      // Turning a rule off clears what it had already raised, rather than
      // leaving alerts nobody can explain.
      result[kind].resolved += await resolveMissing(businessId, kind, [])
      continue
    }

    const open: string[] = []

    if (kind === 'LOW_STOCK') {
      const rows = await db.execute<{
        product_id: number
        branch_id: number
        name: string
        quantity: number
        min_quantity: number
      }>(sql`
        select p.id as product_id, bs.branch_id, p.name, bs.quantity, bs.min_quantity
        from branch_stock bs
        join product p on p.id = bs.product_id
        where p.business_id = ${businessId}
          and p.is_active = true
          and p.is_serialised = false
          and bs.min_quantity > 0
          and bs.quantity <= bs.min_quantity
      `)
      for (const r of rows as unknown as {
        product_id: number
        branch_id: number
        name: string
        quantity: number
        min_quantity: number
      }[]) {
        const key = `LOW_STOCK:${r.branch_id}:${r.product_id}`
        open.push(key)
        if (
          await raise({
            businessId,
            branchId: Number(r.branch_id),
            kind,
            severity: Number(r.quantity) === 0 ? 'CRITICAL' : 'WARNING',
            title: `${r.name} is ${Number(r.quantity) === 0 ? 'out of stock' : 'running low'}`,
            body: `${r.quantity} left at ${branchName.get(Number(r.branch_id)) ?? 'a branch'}, minimum ${r.min_quantity}.`,
            href: '/inventory/low-stock',
            entityType: 'product',
            entityId: Number(r.product_id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'CUSTOMER_OVERDUE') {
      const rows = await db.execute<{
        sale_id: number
        branch_id: number
        invoice_number: string
        customer_name: string
        owing: string
        days: number
      }>(sql`
        select s.id as sale_id, s.branch_id, s.invoice_number, c.name as customer_name,
               (s.total_paise - coalesce((
                  select sum(sp.amount_paise) from sale_payment sp where sp.sale_id = s.id
               ), 0))::text as owing,
               (current_date - s.due_date::date) as days
        from sale s
        join customer c on c.id = s.customer_id
        where s.business_id = ${businessId}
          and s.status <> 'VOIDED'
          and s.due_date is not null
          and s.due_date < now() - (${rule.thresholdDays} || ' days')::interval
          and (s.total_paise - coalesce((
                select sum(sp.amount_paise) from sale_payment sp where sp.sale_id = s.id
              ), 0)) > 0
      `)
      for (const r of rows as unknown as {
        sale_id: number
        branch_id: number
        invoice_number: string
        customer_name: string
        owing: string
        days: number
      }[]) {
        const key = `CUSTOMER_OVERDUE:${r.sale_id}`
        open.push(key)
        if (
          await raise({
            businessId,
            branchId: Number(r.branch_id),
            kind,
            severity: Number(r.days) > 60 ? 'CRITICAL' : 'WARNING',
            title: `${r.customer_name} is ${r.days} days overdue`,
            body: `${formatPaise(BigInt(r.owing))} still owing on ${r.invoice_number}.`,
            href: `/sales/${r.sale_id}`,
            entityType: 'sale',
            entityId: Number(r.sale_id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'SUPPLIER_DUE') {
      const rows = await db.execute<{
        supplier_id: number
        name: string
        balance: string
        oldest: string
      }>(sql`
        select s.id as supplier_id, s.name,
               sum(e.amount_paise)::text as balance,
               min(e.occurred_at)::text as oldest
        from supplier_ledger_entry e
        join supplier s on s.id = e.supplier_id
        where e.business_id = ${businessId}
        group by s.id, s.name
        having sum(e.amount_paise) > 0
           and min(e.occurred_at) < now() - (${rule.thresholdDays} || ' days')::interval
      `)
      for (const r of rows as unknown as {
        supplier_id: number
        name: string
        balance: string
        oldest: string
      }[]) {
        const key = `SUPPLIER_DUE:${r.supplier_id}`
        open.push(key)
        if (
          await raise({
            businessId,
            // Owing a supplier is a business matter, not one branch's.
            branchId: null,
            kind,
            title: `${formatPaise(BigInt(r.balance))} owed to ${r.name}`,
            body: `Unpaid for more than ${rule.thresholdDays} days.`,
            href: `/suppliers/${r.supplier_id}`,
            entityType: 'supplier',
            entityId: Number(r.supplier_id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'CASH_MISMATCH') {
      const rows = await db.execute<{
        id: number
        branch_id: number
        business_date: string
        difference: string
      }>(sql`
        select id, branch_id, business_date::text, cash_difference_paise::text as difference
        from daily_closing
        where business_id = ${businessId}
          and voided_at is null
          and abs(cash_difference_paise) >= ${rule.thresholdPaise.toString()}::bigint
          and closed_at > now() - interval '30 days'
      `)
      for (const r of rows as unknown as {
        id: number
        branch_id: number
        business_date: string
        difference: string
      }[]) {
        const key = `CASH_MISMATCH:${r.id}`
        open.push(key)
        const short = BigInt(r.difference) < 0n
        if (
          await raise({
            businessId,
            branchId: Number(r.branch_id),
            kind,
            severity: 'CRITICAL',
            title: `Till ${short ? 'short' : 'over'} by ${formatPaise(
              BigInt(r.difference) < 0n ? -BigInt(r.difference) : BigInt(r.difference),
            )}`,
            body: `${branchName.get(Number(r.branch_id)) ?? 'A branch'} on ${r.business_date}.`,
            href: '/closing',
            entityType: 'daily_closing',
            entityId: Number(r.id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'UNCLOSED_DAY') {
      /*
       * A day that saw money move and was never closed. Only days that have
       * passed: today is still open by definition, and telling the shop off
       * at lunchtime for not having closed yet would be the fastest way to
       * make every alert ignorable.
       */
      const rows = await db.execute<{ branch_id: number; business_date: string }>(sql`
        select d.branch_id, d.business_date::text
        from cash_drawer_day d
        where d.business_id = ${businessId}
          and d.business_date < (now() at time zone ${SHOP_TIME_ZONE})::date
                                 - (${Math.max(0, rule.thresholdDays - 1)} || ' days')::interval
          and exists (select 1 from cash_movement m where m.drawer_day_id = d.id)
          and not exists (
            select 1 from daily_closing c
            where c.branch_id = d.branch_id
              and c.business_date = d.business_date
              and c.voided_at is null
          )
      `)
      for (const r of rows as unknown as { branch_id: number; business_date: string }[]) {
        const key = `UNCLOSED_DAY:${r.branch_id}:${r.business_date}`
        open.push(key)
        if (
          await raise({
            businessId,
            branchId: Number(r.branch_id),
            kind,
            title: `${r.business_date} was never closed`,
            body: `${branchName.get(Number(r.branch_id)) ?? 'A branch'} took money that day and nobody counted the till.`,
            href: '/closing',
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'STOCK_ADJUSTMENT') {
      const since = new Date(now.getTime() - rule.thresholdDays * 86_400_000)
      const rows = await db.execute<{
        id: number
        branch_id: number
        reason: string
        notes: string
      }>(sql`
        select id, branch_id, reason, coalesce(notes, '') as notes
        from stock_adjustment
        where business_id = ${businessId} and adjusted_at >= ${since.toISOString()}
      `)
      for (const r of rows as unknown as {
        id: number
        branch_id: number
        reason: string
        notes: string
      }[]) {
        const key = `STOCK_ADJUSTMENT:${r.id}`
        open.push(key)
        if (
          await raise({
            businessId,
            branchId: Number(r.branch_id),
            kind,
            severity: 'INFO',
            title: `Stock adjusted at ${branchName.get(Number(r.branch_id)) ?? 'a branch'}`,
            body: `${r.reason.replace(/_/g, ' ').toLowerCase()}${r.notes ? ` — ${r.notes}` : ''}`,
            href: `/adjustments/${r.id}`,
            entityType: 'stock_adjustment',
            entityId: Number(r.id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    if (kind === 'WARRANTY_EXPIRY') {
      const rows = await db.execute<{
        id: number
        branch_id: number | null
        identifier: string | null
        name: string
        expires: string
      }>(sql`
        select d.id, d.current_branch_id as branch_id, d.primary_identifier as identifier,
               p.name, d.warranty_expires_at::date::text as expires
        from device_unit d
        join product p on p.id = d.product_id
        where d.business_id = ${businessId}
          and d.status = 'IN_STOCK'
          and d.warranty_expires_at is not null
          and d.warranty_expires_at >= now()
          and d.warranty_expires_at < now() + (${rule.thresholdDays} || ' days')::interval
      `)
      for (const r of rows as unknown as {
        id: number
        branch_id: number | null
        identifier: string | null
        name: string
        expires: string
      }[]) {
        const key = `WARRANTY_EXPIRY:${r.id}`
        open.push(key)
        if (
          await raise({
            businessId,
            branchId: r.branch_id == null ? null : Number(r.branch_id),
            kind,
            severity: 'INFO',
            title: `${r.name} warranty ends ${r.expires}`,
            body: `${r.identifier ?? 'A handset'} is still in stock. Sell or return it before cover runs out.`,
            href: `/devices/${r.id}`,
            entityType: 'device',
            entityId: Number(r.id),
            dedupeKey: key,
          })
        ) {
          result[kind].raised += 1
        }
      }
    }

    result[kind].resolved += await resolveMissing(businessId, kind, open)
  }

  return result
}

/* ------------------------------------------------------------- reading --- */

/** The kinds this person may be shown at all. */
function visibleKinds(actor: AuthUser): NotificationKind[] {
  return ALL_KINDS.filter((kind) => hasPermission(actor, NOTIFICATION_KINDS[kind].permission))
}

function scopeCondition(actor: AuthUser) {
  const scope = branchScope(actor, null)
  // A branch-limited user sees their branches plus what is business-wide;
  // an owner sees everything. Never "no filter" for a limited user - that is
  // the leak M10 §4.13 already names.
  if (scope === null) return undefined
  if (scope.length === 0) return isNull(notification.branchId)
  return sql`(${notification.branchId} is null or ${notification.branchId} in ${scope})`
}

export type NotificationView = {
  id: number
  kind: NotificationKind
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  title: string
  body: string
  href: string | null
  branchId: number | null
  branchName: string | null
  createdAt: Date
  resolvedAt: Date | null
  isRead: boolean
}

export async function listNotifications(
  actor: AuthUser,
  opts: { includeRead?: boolean; includeResolved?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  const kinds = visibleKinds(actor)
  if (kinds.length === 0) return []

  const conditions = [
    eq(notification.businessId, actor.businessId),
    inArray(notification.kind, kinds),
  ]
  const scope = scopeCondition(actor)
  if (scope) conditions.push(scope)
  if (!opts.includeResolved) conditions.push(isNull(notification.resolvedAt))

  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      href: notification.href,
      branchId: notification.branchId,
      branchName: branch.name,
      createdAt: notification.createdAt,
      resolvedAt: notification.resolvedAt,
      readAt: notificationRead.readAt,
    })
    .from(notification)
    .leftJoin(branch, eq(branch.id, notification.branchId))
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.userId, actor.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(opts.limit ?? 100)

  return rows
    .filter((r) => opts.includeRead || r.readAt === null)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      href: r.href,
      branchId: r.branchId,
      branchName: r.branchName,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      isRead: r.readAt !== null,
    }))
}

/** For the bell. Counts only what this person can see and has not read. */
export async function unreadCount(actor: AuthUser): Promise<number> {
  const kinds = visibleKinds(actor)
  if (kinds.length === 0) return 0

  const conditions = [
    eq(notification.businessId, actor.businessId),
    inArray(notification.kind, kinds),
    isNull(notification.resolvedAt),
    isNull(notificationRead.readAt),
  ]
  const scope = scopeCondition(actor)
  if (scope) conditions.push(scope)

  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(notification)
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.userId, actor.id),
      ),
    )
    .where(and(...conditions))

  return Number(rows[0]?.n ?? 0)
}

/**
 * Mark as read for this person only.
 *
 * Reading is personal: one manager clearing the bell must not hide a till
 * shortage from the owner.
 */
export async function markRead(actor: AuthUser, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0

  // Only rows this person can actually see, so an id from elsewhere does
  // nothing rather than quietly marking someone else's alert.
  const visible = await listNotifications(actor, { includeRead: true, limit: 1000 })
  const allowed = ids.filter((id) => visible.some((n) => n.id === id))
  if (allowed.length === 0) return 0

  await db
    .insert(notificationRead)
    .values(allowed.map((id) => ({ notificationId: id, userId: actor.id })))
    .onConflictDoNothing()
  return allowed.length
}

export async function markAllRead(actor: AuthUser): Promise<number> {
  const open = await listNotifications(actor, { limit: 1000 })
  return markRead(
    actor,
    open.map((n) => n.id),
  )
}

/* --------------------------------------------------------- preferences --- */

export type RuleView = {
  kind: NotificationKind
  label: string
  description: string
  isEnabled: boolean
  thresholdDays: number | null
  thresholdPaise: bigint | null
  /** True when this person has muted it for themselves. */
  mutedForMe: boolean
}

export async function listRules(actor: AuthUser): Promise<RuleView[]> {
  const rows = await db
    .select()
    .from(notificationRule)
    .where(eq(notificationRule.businessId, actor.businessId))

  return visibleKinds(actor).map((kind) => {
    const shop = rows.find((r) => r.kind === kind && r.userId === null)
    const mine = rows.find((r) => r.kind === kind && r.userId === actor.id)
    const defaults = NOTIFICATION_KINDS[kind]
    return {
      kind,
      label: defaults.label,
      description: defaults.description,
      isEnabled: shop?.isEnabled ?? true,
      thresholdDays: shop?.thresholdDays ?? defaults.defaultThresholdDays ?? null,
      thresholdPaise: shop?.thresholdPaise ?? defaults.defaultThresholdPaise ?? null,
      mutedForMe: mine ? !mine.isEnabled : false,
    }
  })
}

/** Change the shop's setting. Needs `notification.manage`. */
export async function setRule(
  actor: AuthUser,
  kind: NotificationKind,
  input: { isEnabled?: boolean; thresholdDays?: number | null; thresholdPaise?: bigint | null },
) {
  await db
    .insert(notificationRule)
    .values({
      businessId: actor.businessId,
      userId: null,
      kind,
      isEnabled: input.isEnabled ?? true,
      thresholdDays: input.thresholdDays ?? null,
      thresholdPaise: input.thresholdPaise ?? null,
    })
    .onConflictDoUpdate({
      target: [notificationRule.businessId, notificationRule.kind],
      targetWhere: isNull(notificationRule.userId),
      set: {
        isEnabled: input.isEnabled ?? true,
        thresholdDays: input.thresholdDays ?? null,
        thresholdPaise: input.thresholdPaise ?? null,
        updatedAt: new Date(),
      },
    })
  return { ok: true }
}

/** Mute or unmute a kind for yourself. Needs no permission - it is your bell. */
export async function setMuted(actor: AuthUser, kind: NotificationKind, muted: boolean) {
  await db
    .insert(notificationRule)
    .values({
      businessId: actor.businessId,
      userId: actor.id,
      kind,
      isEnabled: !muted,
    })
    .onConflictDoUpdate({
      target: [notificationRule.businessId, notificationRule.userId, notificationRule.kind],
      targetWhere: sql`${notificationRule.userId} is not null`,
      set: { isEnabled: !muted, updatedAt: new Date() },
    })
  return { ok: true }
}

/* ------------------------------------------------------------ warranty --- */

/** Handsets whose cover runs out soon, or has just done so (PRD FR-29.2). */
export async function warrantyExpiring(
  actor: AuthUser,
  opts: { withinDays?: number; page?: number; pageSize?: number } = {},
) {
  const scope = branchScope(actor, null)
  const withinDays = opts.withinDays ?? 60
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))

  /*
   * A window either side of today, not everything ever.
   *
   * There was no lower bound: a handset whose cover lapsed three years ago sat
   * in "expiring within 60 days" for ever, and on a shop that has been running
   * a while the list became mostly ancient history with the few pieces
   * actually running out buried in it. Expired stock is worth showing while it
   * is still news - the same span back as the one being looked forward.
   */
  const conditions = [
    sql`d.business_id = ${actor.businessId}`,
    sql`d.warranty_expires_at is not null`,
    sql`d.warranty_expires_at < now() + (${withinDays} || ' days')::interval`,
    sql`d.warranty_expires_at > now() - (${withinDays} || ' days')::interval`,
  ]
  if (scope !== null) {
    conditions.push(
      scope.length > 0 ? sql`d.current_branch_id in ${scope}` : sql`false`,
    )
  }
  const where = sql.join(conditions, sql` and `)

  const rows = await db.execute<{
    id: number
    identifier: string | null
    product_name: string
    branch_name: string | null
    status: string
    provider: string | null
    expires: string
    days_left: number
    customer_id: number | null
    customer_name: string | null
    sale_id: number | null
    invoice_number: string | null
  }>(sql`
    select d.id, d.primary_identifier as identifier, p.name as product_name,
           b.name as branch_name, d.status, d.warranty_provider as provider,
           d.warranty_expires_at::date::text as expires,
           (d.warranty_expires_at::date - current_date) as days_left,
           sold.customer_id, sold.customer_name, sold.sale_id, sold.invoice_number
    from device_unit d
    join product p on p.id = d.product_id
    left join branch b on b.id = d.current_branch_id
    /*
     * Who owns it, if anyone (PRD FR-29.1). A warranty on a sold handset is
     * only useful with the customer beside it - the question the list has to
     * answer is "this is still covered, whose is it?". The most recent sale,
     * because a handset that came back and went out again belongs to whoever
     * bought it last.
     */
    left join lateral (
      select s.id as sale_id, s.invoice_number, s.customer_id, c.name as customer_name
      from sale_item si
      join sale s on s.id = si.sale_id
      left join customer c on c.id = s.customer_id
      where si.device_id = d.id and s.status <> 'VOIDED'
      order by s.sold_at desc
      limit 1
    ) sold on true
    where ${where}
    order by d.warranty_expires_at asc
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `)

  const totals = await db.execute<{ n: string }>(sql`
    select count(*)::text as n from device_unit d where ${where}
  `)

  return {
    rows: (rows as unknown as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      identifier: r.identifier as string | null,
      productName: r.product_name as string,
      branchName: r.branch_name as string | null,
      status: r.status as string,
      provider: r.provider as string | null,
      expires: r.expires as string,
      daysLeft: Number(r.days_left),
      customerId: r.customer_id == null ? null : Number(r.customer_id),
      customerName: (r.customer_name as string | null) ?? null,
      saleId: r.sale_id == null ? null : Number(r.sale_id),
      invoiceNumber: (r.invoice_number as string | null) ?? null,
    })),
    total: Number((totals as unknown as { n: string }[])[0]?.n ?? 0),
    page,
    pageSize,
    withinDays,
  }
}
