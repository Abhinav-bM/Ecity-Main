import { and, asc, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  account,
  accountTransaction,
  branch,
  cashDrawerDay,
  cashMovement,
  dailyClosing,
  paymentMethod,
} from '@/server/db/schema'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'

/**
 * The cash drawer (PRD FR-11.1 – FR-11.5).
 *
 * One drawer per branch per business day. Expected cash is ALWAYS derived -
 * opening plus the sum of the movements (docs/03 §4.2) - so it can never drift
 * from the rows it claims to summarise.
 *
 * Every module that touches money posts here: M4 cash sales, M5 collections,
 * M6 refunds, M7 expenses and supplier payments. That is the whole point of
 * the table; a drawer that only knows about some of the cash reconciles to
 * nothing.
 */

/** Today where the shop is, not where the server is. */
export function businessDateFor(when: Date = new Date(), timeZone = 'Asia/Kolkata'): string {
  // en-CA renders ISO-shaped yyyy-mm-dd, which is what a `date` column wants.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when)
}

/**
 * The branch's drawer for a date, opened if it is not there yet.
 *
 * Opened lazily rather than by anyone pressing a button: a counter that starts
 * selling has a drawer whether or not someone remembered to open one, which is
 * the difference between a reconciliation that works and one that is missing
 * the first hour of trade.
 *
 * The opening balance carries from the previous closing's COUNTED cash, not
 * its expected cash - the drawer starts with what is actually in it.
 */
export async function openDrawerDay(
  tx: DbOrTx,
  input: { businessId: number; branchId: number; businessDate: string },
): Promise<{ id: number; status: 'OPEN' | 'CLOSED' }> {
  const existing = (
    await tx
      .select({ id: cashDrawerDay.id, status: cashDrawerDay.status })
      .from(cashDrawerDay)
      .where(
        and(
          eq(cashDrawerDay.branchId, input.branchId),
          eq(cashDrawerDay.businessDate, input.businessDate),
        ),
      )
      .limit(1)
  )[0]
  if (existing) return existing

  // The last day this branch closed, whenever that was - a shop shut for a
  // week still starts with the cash it was left with.
  const previous = (
    await tx
      .select({ counted: dailyClosing.countedCashPaise })
      .from(dailyClosing)
      .where(
        and(
          eq(dailyClosing.branchId, input.branchId),
          lt(dailyClosing.businessDate, input.businessDate),
          isNull(dailyClosing.voidedAt),
        ),
      )
      .orderBy(desc(dailyClosing.businessDate))
      .limit(1)
  )[0]

  const created = (
    await tx
      .insert(cashDrawerDay)
      .values({
        businessId: input.businessId,
        branchId: input.branchId,
        businessDate: input.businessDate,
        openingPaise: previous?.counted ?? 0n,
      })
      .onConflictDoNothing()
      .returning({ id: cashDrawerDay.id, status: cashDrawerDay.status })
  )[0]
  if (created) return created

  // Two tills opened the same drawer at once; the unique index settled it.
  const raced = (
    await tx
      .select({ id: cashDrawerDay.id, status: cashDrawerDay.status })
      .from(cashDrawerDay)
      .where(
        and(
          eq(cashDrawerDay.branchId, input.branchId),
          eq(cashDrawerDay.businessDate, input.businessDate),
        ),
      )
      .limit(1)
  )[0]
  if (!raced) throw new AppError('Could not open the cash drawer.', 500, 'NO_DRAWER')
  return raced
}

export type CashPosting = {
  businessId: number
  branchId: number
  movement: (typeof cashMovement.$inferInsert)['movement']
  /** Positive in, negative out. */
  amountPaise: bigint
  refType?: string
  refId?: number
  note?: string
  occurredAt?: Date
  actorId?: number | null
  /** Only an authorised correction may land in a day that is already closed. */
  allowClosedDay?: boolean
}

/**
 * Record cash moving in or out of a branch till.
 *
 * Refuses a closed day unless the caller has been authorised to correct one
 * (PRD FR-13.4, OQ-5). When it does land in a closed day it is flagged, so the
 * gap between the signed closing and a recomputed one is visible rather than
 * silent.
 */
export async function postCashMovement(tx: DbOrTx, input: CashPosting): Promise<void> {
  if (input.amountPaise === 0n) return

  const businessDate = businessDateFor(input.occurredAt ?? new Date())
  const day = await openDrawerDay(tx, {
    businessId: input.businessId,
    branchId: input.branchId,
    businessDate,
  })

  if (day.status === 'CLOSED' && !input.allowClosedDay) {
    throw conflict(
      `${businessDate} has already been closed for this branch. Correcting a closed day needs authorisation.`,
    )
  }

  await tx.insert(cashMovement).values({
    businessId: input.businessId,
    drawerDayId: day.id,
    branchId: input.branchId,
    movement: input.movement,
    amountPaise: input.amountPaise,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
    postedAfterClose: day.status === 'CLOSED',
    occurredAt: input.occurredAt ?? new Date(),
    createdBy: input.actorId ?? null,
  })
}

/**
 * Money that did not go into the till goes to an account instead.
 *
 * A payment method either affects the cash drawer or it does not (M1 set that
 * flag). This is the one place that decision is read, so cash and non-cash can
 * never be routed differently by two callers.
 */
export async function postByPaymentMethod(
  tx: DbOrTx,
  input: CashPosting & { paymentMethodId: number; accountId?: number | null },
): Promise<void> {
  const method = (
    await tx
      .select({ affectsCashDrawer: paymentMethod.affectsCashDrawer })
      .from(paymentMethod)
      .where(eq(paymentMethod.id, input.paymentMethodId))
      .limit(1)
  )[0]

  if (method?.affectsCashDrawer) {
    await postCashMovement(tx, input)
    return
  }

  // Non-cash with no account named yet is still recorded on the sale itself;
  // it simply has no account balance to move. Accounts are opt-in (FR-12.1),
  // and a shop that has not set any up must still be able to take a card.
  if (!input.accountId) return

  await tx.insert(accountTransaction).values({
    businessId: input.businessId,
    accountId: input.accountId,
    branchId: input.branchId,
    movement: input.movement,
    amountPaise: input.amountPaise,
    businessDate: businessDateFor(input.occurredAt ?? new Date()),
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
    occurredAt: input.occurredAt ?? new Date(),
    createdBy: input.actorId ?? null,
  })
}

/* ------------------------------------------------------------ reading --- */

export type DrawerDay = {
  id: number | null
  branchId: number
  branchName: string
  businessDate: string
  status: 'OPEN' | 'CLOSED'
  openingPaise: bigint
  inPaise: bigint
  outPaise: bigint
  /** FR-11.3. Opening + in - out, derived every time it is asked for. */
  expectedPaise: bigint
  movements: {
    id: number
    movement: string
    amountPaise: bigint
    refType: string | null
    refId: number | null
    note: string | null
    postedAfterClose: boolean
    occurredAt: Date
  }[]
}

function assertBranchVisible(actor: AuthUser, branchId: number) {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(branchId)) throw notFound('Branch')
}

/** One branch's drawer for one day, with every movement behind the total. */
export async function getDrawerDay(
  actor: AuthUser,
  branchId: number,
  businessDate: string,
): Promise<DrawerDay> {
  assertBranchVisible(actor, branchId)

  const branchRow = (
    await db
      .select({ name: branch.name })
      .from(branch)
      .where(and(eq(branch.id, branchId), eq(branch.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!branchRow) throw notFound('Branch')

  const day = (
    await db
      .select({
        id: cashDrawerDay.id,
        status: cashDrawerDay.status,
        openingPaise: cashDrawerDay.openingPaise,
      })
      .from(cashDrawerDay)
      .where(
        and(eq(cashDrawerDay.branchId, branchId), eq(cashDrawerDay.businessDate, businessDate)),
      )
      .limit(1)
  )[0]

  // A day nobody traded on is a real answer, not a missing one.
  if (!day) {
    const previous = (
      await db
        .select({ counted: dailyClosing.countedCashPaise })
        .from(dailyClosing)
        .where(
          and(
            eq(dailyClosing.branchId, branchId),
            lt(dailyClosing.businessDate, businessDate),
            isNull(dailyClosing.voidedAt),
          ),
        )
        .orderBy(desc(dailyClosing.businessDate))
        .limit(1)
    )[0]
    const opening = previous?.counted ?? 0n
    return {
      id: null,
      branchId,
      branchName: branchRow.name,
      businessDate,
      status: 'OPEN',
      openingPaise: opening,
      inPaise: 0n,
      outPaise: 0n,
      expectedPaise: opening,
      movements: [],
    }
  }

  const movements = await db
    .select({
      id: cashMovement.id,
      movement: cashMovement.movement,
      amountPaise: cashMovement.amountPaise,
      refType: cashMovement.refType,
      refId: cashMovement.refId,
      note: cashMovement.note,
      postedAfterClose: cashMovement.postedAfterClose,
      occurredAt: cashMovement.occurredAt,
    })
    .from(cashMovement)
    .where(eq(cashMovement.drawerDayId, day.id))
    .orderBy(asc(cashMovement.occurredAt), asc(cashMovement.id))

  let inPaise = 0n
  let outPaise = 0n
  for (const m of movements) {
    if (m.amountPaise >= 0n) inPaise += m.amountPaise
    else outPaise += -m.amountPaise
  }

  return {
    id: day.id,
    branchId,
    branchName: branchRow.name,
    businessDate,
    status: day.status,
    openingPaise: day.openingPaise,
    inPaise,
    outPaise,
    expectedPaise: day.openingPaise + inPaise - outPaise,
    movements,
  }
}

/** FR-11.3, as one number. Used by the closing screen and its tests. */
export async function expectedCashPaise(
  branchId: number,
  businessDate: string,
  tx: DbOrTx = db,
): Promise<bigint> {
  const day = (
    await tx
      .select({ id: cashDrawerDay.id, openingPaise: cashDrawerDay.openingPaise })
      .from(cashDrawerDay)
      .where(
        and(eq(cashDrawerDay.branchId, branchId), eq(cashDrawerDay.businessDate, businessDate)),
      )
      .limit(1)
  )[0]
  if (!day) return 0n

  const sums = (
    await tx
      .select({ total: sql<string>`coalesce(sum(${cashMovement.amountPaise}), 0)` })
      .from(cashMovement)
      .where(eq(cashMovement.drawerDayId, day.id))
  )[0]

  return day.openingPaise + BigInt(sums?.total ?? '0')
}

/** Which branches the caller may act on, for the drawer and closing screens. */
export function visibleBranchIds(actor: AuthUser): number[] | null {
  return branchScope(actor, null)
}

export function canCorrectClosedDays(actor: AuthUser): boolean {
  return hasPermission(actor, 'closing.correct')
}

/* --------------------------------------------------------- accounts --- */

export type AccountBalance = {
  id: number
  name: string
  type: string
  branchId: number | null
  branchName: string | null
  accountNumber: string | null
  bankName: string | null
  upiId: string | null
  isActive: boolean
  /** Opening plus every transaction. Never a stored counter (docs/03 §4.2). */
  balancePaise: bigint
  reconciledBalancePaise: bigint | null
  reconciledAt: Date | null
  /** FR-12.4. What the statement said, less what the books say. */
  unreconciledPaise: bigint | null
}

export async function listAccounts(
  actor: AuthUser,
  opts: { includeInactive?: boolean } = {},
): Promise<AccountBalance[]> {
  const conditions: SQL[] = [eq(account.businessId, actor.businessId)]
  if (!opts.includeInactive) conditions.push(eq(account.isActive, true))

  const rows = await db
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      branchId: account.branchId,
      branchName: branch.name,
      accountNumber: account.accountNumber,
      bankName: account.bankName,
      upiId: account.upiId,
      isActive: account.isActive,
      openingBalancePaise: account.openingBalancePaise,
      reconciledBalancePaise: account.reconciledBalancePaise,
      reconciledAt: account.reconciledAt,
      moved: sql<string>`(
        select coalesce(sum(at.amount_paise), 0)
        from account_transaction at where at.account_id = "account"."id"
      )`,
    })
    .from(account)
    .leftJoin(branch, eq(branch.id, account.branchId))
    .where(and(...conditions))
    .orderBy(asc(account.sortOrder), asc(account.name))

  // A branch-limited user sees the shared accounts plus their own branches'.
  const scope = branchScope(actor, null)

  return rows
    .filter((r) => scope === null || r.branchId === null || scope.includes(r.branchId))
    .map((r) => {
      const balance = r.openingBalancePaise + BigInt(r.moved)
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        branchId: r.branchId,
        branchName: r.branchName,
        accountNumber: r.accountNumber,
        bankName: r.bankName,
        upiId: r.upiId,
        isActive: r.isActive,
        balancePaise: balance,
        reconciledBalancePaise: r.reconciledBalancePaise,
        reconciledAt: r.reconciledAt,
        unreconciledPaise:
          r.reconciledBalancePaise === null ? null : r.reconciledBalancePaise - balance,
      }
    })
}

export async function accountBalancePaise(accountId: number, tx: DbOrTx = db): Promise<bigint> {
  const row = (
    await tx
      .select({
        opening: account.openingBalancePaise,
        moved: sql<string>`(
          select coalesce(sum(at.amount_paise), 0)
          from account_transaction at where at.account_id = ${accountId}
        )`,
      })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)
  )[0]
  if (!row) throw notFound('Account')
  return row.opening + BigInt(row.moved)
}

export async function accountLedger(
  actor: AuthUser,
  accountId: number,
  filters: { page: number; pageSize: number },
) {
  const acc = (await listAccounts(actor, { includeInactive: true })).find((a) => a.id === accountId)
  if (!acc) throw notFound('Account')

  const offset = (filters.page - 1) * filters.pageSize
  const [rows, counted] = await Promise.all([
    db
      .select({
        id: accountTransaction.id,
        movement: accountTransaction.movement,
        amountPaise: accountTransaction.amountPaise,
        businessDate: accountTransaction.businessDate,
        refType: accountTransaction.refType,
        refId: accountTransaction.refId,
        note: accountTransaction.note,
        occurredAt: accountTransaction.occurredAt,
        branchName: branch.name,
      })
      .from(accountTransaction)
      .leftJoin(branch, eq(branch.id, accountTransaction.branchId))
      .where(eq(accountTransaction.accountId, accountId))
      .orderBy(desc(accountTransaction.occurredAt), desc(accountTransaction.id))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ n: sql<string>`count(*)` })
      .from(accountTransaction)
      .where(eq(accountTransaction.accountId, accountId)),
  ])

  return { account: acc, rows, total: Number(counted[0]?.n ?? 0) }
}

/** Only positive money exists here; a transfer of nothing is a mistake. */
export function assertPositive(amountPaise: bigint, what = 'amount') {
  if (amountPaise <= 0n) {
    throw new AppError(`The ${what} must be more than zero.`, 422, 'BAD_AMOUNT')
  }
}
