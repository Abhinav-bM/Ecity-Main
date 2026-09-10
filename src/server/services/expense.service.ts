import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  account,
  appUser,
  branch,
  cashDrawerDay,
  expense,
  expenseCategory,
  paymentMethod,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { assertBranchAcceptsTransactions } from './branch.service'
import { businessDateFor, postByPaymentMethod } from './cash.service'

/**
 * Shop running costs (PRD FR-10.1 – FR-10.3).
 *
 * An expense is not just a number in a report: FR-10.3 says it takes money out
 * of the drawer or an account, so recording one and posting the money out
 * happen in the same transaction or neither happens.
 *
 * An expense is never edited or deleted. It is voided, which posts the money
 * back and leaves both entries standing - the same rule the ledgers follow.
 */

export type ExpenseInput = {
  branchId: number
  categoryId: number
  paymentMethodId: number
  accountId?: number | null
  amountPaise: bigint
  businessDate?: string
  description?: string
  reference?: string
}

export async function createExpense(
  actor: AuthUser,
  ctx: AuditContext,
  input: ExpenseInput,
): Promise<{ id: number }> {
  if (input.amountPaise <= 0n) {
    throw new AppError('An expense must be more than zero.', 422, 'BAD_AMOUNT')
  }
  await assertBranchAcceptsTransactions(actor, input.branchId)

  const businessDate = input.businessDate ?? businessDateFor()

  return db.transaction(async (tx) => {
    const category = (
      await tx
        .select({ id: expenseCategory.id, isActive: expenseCategory.isActive })
        .from(expenseCategory)
        .where(
          and(
            eq(expenseCategory.id, input.categoryId),
            eq(expenseCategory.businessId, actor.businessId),
          ),
        )
        .limit(1)
    )[0]
    if (!category?.isActive) {
      throw new AppError('That expense category is not available.', 422, 'BAD_CATEGORY')
    }

    const method = (
      await tx
        .select({
          id: paymentMethod.id,
          isActive: paymentMethod.isActive,
          affectsCashDrawer: paymentMethod.affectsCashDrawer,
        })
        .from(paymentMethod)
        .where(
          and(
            eq(paymentMethod.id, input.paymentMethodId),
            eq(paymentMethod.businessId, actor.businessId),
          ),
        )
        .limit(1)
    )[0]
    if (!method?.isActive) {
      throw new AppError('That payment method is not available.', 422, 'BAD_METHOD')
    }

    if (input.accountId) {
      const acc = (
        await tx
          .select({ id: account.id, isActive: account.isActive })
          .from(account)
          .where(and(eq(account.id, input.accountId), eq(account.businessId, actor.businessId)))
          .limit(1)
      )[0]
      if (!acc?.isActive) throw new AppError('That account is not available.', 422, 'BAD_ACCOUNT')
    }

    /*
     * PRD FR-13.4 / OQ-5. Backdating into a closed day is a correction, and
     * corrections are authorised. The drawer service enforces this too; the
     * check here is so the message names the right thing.
     */
    const allowClosedDay = hasPermission(actor, 'closing.correct')
    const day = (
      await tx
        .select({ status: cashDrawerDay.status })
        .from(cashDrawerDay)
        .where(
          and(
            eq(cashDrawerDay.branchId, input.branchId),
            eq(cashDrawerDay.businessDate, businessDate),
          ),
        )
        .limit(1)
    )[0]
    const intoClosedDay = day?.status === 'CLOSED'
    if (intoClosedDay && !allowClosedDay) {
      throw conflict(
        `${businessDate} is closed for this branch. Recording into a closed day needs authorisation.`,
      )
    }

    const created = (
      await tx
        .insert(expense)
        .values({
          businessId: actor.businessId,
          branchId: input.branchId,
          categoryId: input.categoryId,
          paymentMethodId: input.paymentMethodId,
          accountId: input.accountId ?? null,
          amountPaise: input.amountPaise,
          businessDate,
          description: input.description?.trim() || null,
          reference: input.reference?.trim() || null,
          postedAfterClose: intoClosedDay,
          createdBy: actor.id,
        })
        .returning({ id: expense.id })
    )[0]!

    // FR-10.3. Money out, so the amount is negative.
    await postByPaymentMethod(tx, {
      businessId: actor.businessId,
      branchId: input.branchId,
      paymentMethodId: input.paymentMethodId,
      accountId: input.accountId ?? null,
      movement: 'EXPENSE',
      amountPaise: -input.amountPaise,
      refType: 'expense',
      refId: created.id,
      note: input.description?.trim() || undefined,
      occurredAt: new Date(`${businessDate}T12:00:00+05:30`),
      actorId: actor.id,
      allowClosedDay,
    })

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'expense',
        entityId: created.id,
        summary: `Expense recorded on ${businessDate}`,
      },
      tx,
    )

    return { id: created.id }
  })
}

/**
 * Void an expense (never edit or delete it).
 *
 * The original row stays and the money is posted back, so the drawer for the
 * day it was recorded in still tells the truth about what happened.
 */
export async function voidExpense(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new AppError('Say why it is being voided.', 422, 'NO_REASON')
  }

  await db.transaction(async (tx) => {
    const row = (
      await tx
        .select()
        .from(expense)
        .where(and(eq(expense.id, id), eq(expense.businessId, actor.businessId)))
        .limit(1)
    )[0]
    if (!row) throw notFound('Expense')
    if (row.voidedAt) throw conflict('That expense has already been voided.')

    const scope = branchScope(actor, null)
    if (scope !== null && !scope.includes(row.branchId)) throw notFound('Expense')

    // Conditional, so two voids of the same expense cannot both refund it.
    const voided = await tx
      .update(expense)
      .set({
        voidedAt: new Date(),
        voidedBy: actor.id,
        voidReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(and(eq(expense.id, id), isNull(expense.voidedAt)))
      .returning({ id: expense.id })
    if (!voided[0]) throw conflict('That expense has already been voided.')

    // The money comes back the way it went out.
    await postByPaymentMethod(tx, {
      businessId: actor.businessId,
      branchId: row.branchId,
      paymentMethodId: row.paymentMethodId,
      accountId: row.accountId,
      movement: 'ADJUSTMENT',
      amountPaise: row.amountPaise,
      refType: 'expense_void',
      refId: id,
      note: `Voided: ${reason.trim()}`,
      actorId: actor.id,
      allowClosedDay: hasPermission(actor, 'closing.correct'),
    })

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'expense',
        entityId: id,
        summary: `Expense voided — ${reason.trim()}`,
      },
      tx,
    )
  })
}

/* ------------------------------------------------------------ reading --- */

/** One expense, for its own page (PRD FR-10.2 — the receipt lives there). */
export async function getExpense(actor: AuthUser, id: number) {
  const row = (
    await db
      .select({
        id: expense.id,
        branchId: expense.branchId,
        amountPaise: expense.amountPaise,
        businessDate: expense.businessDate,
        // The moment it was keyed in, which is not always the day it books to.
        createdAt: expense.createdAt,
        description: expense.description,
        reference: expense.reference,
        postedAfterClose: expense.postedAfterClose,
        voidedAt: expense.voidedAt,
        voidReason: expense.voidReason,
        categoryName: expenseCategory.name,
        methodName: paymentMethod.name,
        branchName: branch.name,
        recordedBy: appUser.name,
      })
      .from(expense)
      .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
      .innerJoin(paymentMethod, eq(paymentMethod.id, expense.paymentMethodId))
      .innerJoin(branch, eq(branch.id, expense.branchId))
      .leftJoin(appUser, eq(appUser.id, expense.createdBy))
      .where(and(eq(expense.id, id), eq(expense.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Expense')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.branchId)) throw notFound('Expense')

  return row
}

export type ExpenseFilters = {
  branchId?: number
  categoryId?: number
  from?: string
  to?: string
  includeVoided?: boolean
  page: number
  pageSize: number
}

export async function listExpenses(actor: AuthUser, filters: ExpenseFilters) {
  const conditions: SQL[] = [eq(expense.businessId, actor.businessId)]

  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${expense.branchId} in ${scope.length ? scope : [-1]}`)
  } else if (filters.branchId) {
    conditions.push(eq(expense.branchId, filters.branchId))
  }
  if (filters.categoryId) conditions.push(eq(expense.categoryId, filters.categoryId))
  if (filters.from) conditions.push(gte(expense.businessDate, filters.from))
  if (filters.to) conditions.push(lte(expense.businessDate, filters.to))
  if (!filters.includeVoided) conditions.push(isNull(expense.voidedAt))

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, counted, totals] = await Promise.all([
    db
      .select({
        id: expense.id,
        amountPaise: expense.amountPaise,
        businessDate: expense.businessDate,
        // The moment it was keyed in, which is not always the day it books to.
        createdAt: expense.createdAt,
        description: expense.description,
        reference: expense.reference,
        postedAfterClose: expense.postedAfterClose,
        voidedAt: expense.voidedAt,
        voidReason: expense.voidReason,
        categoryName: expenseCategory.name,
        methodName: paymentMethod.name,
        branchName: branch.name,
        recordedBy: appUser.name,
      })
      .from(expense)
      .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
      .innerJoin(paymentMethod, eq(paymentMethod.id, expense.paymentMethodId))
      .innerJoin(branch, eq(branch.id, expense.branchId))
      .leftJoin(appUser, eq(appUser.id, expense.createdBy))
      .where(where)
      // Newest first: the day you are working on is the one you want.
      .orderBy(desc(expense.businessDate), desc(expense.id))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ n: sql<string>`count(*)` }).from(expense).where(where),
    db
      .select({ total: sql<string>`coalesce(sum(${expense.amountPaise}), 0)` })
      .from(expense)
      .where(and(where, isNull(expense.voidedAt))),
  ])

  return {
    rows,
    total: Number(counted[0]?.n ?? 0),
    // Over the whole filter, not just this page - a page total is useless.
    totalPaise: BigInt(totals[0]?.total ?? '0'),
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

/** What a branch spent on a day, by category. Used by the closing screen. */
export async function expenseTotalsFor(branchId: number, businessDate: string) {
  const rows = await db
    .select({
      categoryName: expenseCategory.name,
      totalPaise: sql<string>`coalesce(sum(${expense.amountPaise}), 0)`,
    })
    .from(expense)
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
    .where(
      and(
        eq(expense.branchId, branchId),
        eq(expense.businessDate, businessDate),
        isNull(expense.voidedAt),
      ),
    )
    .groupBy(expenseCategory.name)
    .orderBy(asc(expenseCategory.name))

  return rows.map((r) => ({ categoryName: r.categoryName, totalPaise: BigInt(r.totalPaise) }))
}
