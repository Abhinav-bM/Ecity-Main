import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { normaliseStateCode, stateCodeFromGstin } from '@/lib/gst'
import { db } from '@/server/db'
import { business, expenseCategory, paymentMethod, taxRate } from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

/* ------------------------------------------------------------- profile --- */

export async function getBusiness(actor: AuthUser) {
  const rows = await db.select().from(business).where(eq(business.id, actor.businessId)).limit(1)
  const row = rows[0]
  if (!row) throw notFound('Business')
  return row
}

export async function updateBusiness(
  actor: AuthUser,
  ctx: AuditContext,
  input: Partial<typeof business.$inferInsert>,
) {
  const before = await getBusiness(actor)
  // '' from an unset picker must become NULL, or the place-of-supply fallback
  // chain on an invoice sees a truthy blank and stops there.
  const values =
    'stateCode' in input
      ? { ...input, stateCode: normaliseStateCode(input.stateCode) ?? stateCodeFromGstin(input.gstin) }
      : input

  await db
    .update(business)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(business.id, actor.businessId))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'business',
    entityId: actor.businessId,
    summary: 'Updated business profile',
    changes: diff(before, values),
  })
}

/* ------------------------------------------------------------ tax rates --- */

export async function listTaxRates(actor: AuthUser) {
  return db
    .select()
    .from(taxRate)
    .where(eq(taxRate.businessId, actor.businessId))
    .orderBy(asc(taxRate.rateBasisPoints))
}

/**
 * Rates are integer basis points: 18% is 1800. Never a float - a rate
 * multiplies money, and money is integer paise (docs/03 §4.1).
 */
export async function upsertTaxRate(
  actor: AuthUser,
  ctx: AuditContext,
  input: { id?: number; name: string; rateBasisPoints: number; isDefault?: boolean },
) {
  if (input.rateBasisPoints < 0 || input.rateBasisPoints > 10000) {
    throw new AppError('Tax rate must be between 0% and 100%.', 422, 'INVALID_RATE')
  }

  const clash = await db
    .select({ id: taxRate.id })
    .from(taxRate)
    .where(and(eq(taxRate.businessId, actor.businessId), eq(taxRate.name, input.name)))
    .limit(1)
  if (clash[0] && clash[0].id !== input.id) {
    throw conflict('A tax rate with this name already exists.')
  }

  return db.transaction(async (tx) => {
    // Only one default rate. Clearing first keeps the invariant simple.
    if (input.isDefault) {
      await tx
        .update(taxRate)
        .set({ isDefault: false })
        .where(eq(taxRate.businessId, actor.businessId))
    }

    if (input.id) {
      const before = (
        await tx.select().from(taxRate).where(eq(taxRate.id, input.id)).limit(1)
      )[0]
      if (!before) throw notFound('Tax rate')
      await tx
        .update(taxRate)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(taxRate.id, input.id))
      await writeAudit(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'tax_rate',
          entityId: input.id,
          summary: `Updated tax rate ${input.name}`,
          changes: diff(before, input),
        },
        tx,
      )
      return { id: input.id }
    }

    const created = (
      await tx
        .insert(taxRate)
        .values({
          businessId: actor.businessId,
          name: input.name,
          rateBasisPoints: input.rateBasisPoints,
          isDefault: input.isDefault ?? false,
        })
        .returning()
    )[0]!
    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'tax_rate',
        entityId: created.id,
        summary: `Created tax rate ${created.name}`,
        changes: diff(null, { name: created.name, rateBasisPoints: created.rateBasisPoints }),
      },
      tx,
    )
    return { id: created.id }
  })
}

export async function setTaxRateActive(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  isActive: boolean,
) {
  const rows = await db
    .select()
    .from(taxRate)
    .where(and(eq(taxRate.id, id), eq(taxRate.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Tax rate')
  if (!isActive && row.isDefault) {
    throw new AppError(
      'The default tax rate cannot be deactivated. Make another rate the default first.',
      422,
      'DEFAULT_RATE',
    )
  }
  await db.update(taxRate).set({ isActive, updatedAt: new Date() }).where(eq(taxRate.id, id))
  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'tax_rate',
    entityId: id,
    summary: `${isActive ? 'Activated' : 'Deactivated'} tax rate ${row.name}`,
    changes: diff({ isActive: row.isActive }, { isActive }),
  })
}

/* ------------------------------------------------------ payment methods --- */

export async function listPaymentMethods(actor: AuthUser) {
  return db
    .select()
    .from(paymentMethod)
    .where(eq(paymentMethod.businessId, actor.businessId))
    .orderBy(asc(paymentMethod.sortOrder), asc(paymentMethod.name))
}

export async function upsertPaymentMethod(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    id?: number
    code: string
    name: string
    type: (typeof paymentMethod.$inferInsert)['type']
    affectsCashDrawer?: boolean
    sortOrder?: number
  },
) {
  const clash = await db
    .select({ id: paymentMethod.id })
    .from(paymentMethod)
    .where(
      and(eq(paymentMethod.businessId, actor.businessId), eq(paymentMethod.code, input.code)),
    )
    .limit(1)
  if (clash[0] && clash[0].id !== input.id) {
    throw conflict('A payment method with this code already exists.')
  }

  if (input.id) {
    const before = (
      await db.select().from(paymentMethod).where(eq(paymentMethod.id, input.id)).limit(1)
    )[0]
    if (!before) throw notFound('Payment method')
    await db
      .update(paymentMethod)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(paymentMethod.id, input.id))
    await writeAudit(ctx, {
      action: 'UPDATE',
      entityType: 'payment_method',
      entityId: input.id,
      summary: `Updated payment method ${input.name}`,
      changes: diff(before, input),
    })
    return { id: input.id }
  }

  const created = (
    await db
      .insert(paymentMethod)
      .values({
        businessId: actor.businessId,
        code: input.code,
        name: input.name,
        type: input.type,
        affectsCashDrawer: input.affectsCashDrawer ?? input.type === 'CASH',
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
  )[0]!
  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'payment_method',
    entityId: created.id,
    summary: `Created payment method ${created.name}`,
  })
  return { id: created.id }
}

export async function setPaymentMethodActive(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  isActive: boolean,
) {
  const rows = await db
    .select()
    .from(paymentMethod)
    .where(and(eq(paymentMethod.id, id), eq(paymentMethod.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Payment method')

  // The shop must always be able to take cash.
  if (!isActive && row.type === 'CASH') {
    const others = await db
      .select({ id: paymentMethod.id })
      .from(paymentMethod)
      .where(
        and(
          eq(paymentMethod.businessId, actor.businessId),
          eq(paymentMethod.type, 'CASH'),
          eq(paymentMethod.isActive, true),
          ne(paymentMethod.id, id),
        ),
      )
    if (others.length === 0) {
      throw new AppError(
        'At least one cash payment method must stay active.',
        422,
        'LAST_CASH_METHOD',
      )
    }
  }

  await db
    .update(paymentMethod)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(paymentMethod.id, id))
  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'payment_method',
    entityId: id,
    summary: `${isActive ? 'Activated' : 'Deactivated'} ${row.name}`,
  })
}

/* --------------------------------------------------- expense categories --- */

export async function listExpenseCategories(actor: AuthUser) {
  return db
    .select()
    .from(expenseCategory)
    .where(eq(expenseCategory.businessId, actor.businessId))
    .orderBy(asc(expenseCategory.name))
}

export async function createExpenseCategory(
  actor: AuthUser,
  ctx: AuditContext,
  input: { name: string },
) {
  const clash = await db
    .select({ id: expenseCategory.id })
    .from(expenseCategory)
    .where(
      and(
        eq(expenseCategory.businessId, actor.businessId),
        eq(expenseCategory.name, input.name),
      ),
    )
    .limit(1)
  if (clash[0]) throw conflict('An expense category with this name already exists.')

  const created = (
    await db
      .insert(expenseCategory)
      .values({ businessId: actor.businessId, name: input.name })
      .returning()
  )[0]!
  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'expense_category',
    entityId: created.id,
    summary: `Created expense category ${created.name}`,
  })
  return { id: created.id }
}

export async function setExpenseCategoryActive(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  isActive: boolean,
) {
  const rows = await db
    .select()
    .from(expenseCategory)
    .where(and(eq(expenseCategory.id, id), eq(expenseCategory.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Expense category')
  await db
    .update(expenseCategory)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(expenseCategory.id, id))
  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'expense_category',
    entityId: id,
    summary: `${isActive ? 'Activated' : 'Deactivated'} ${row.name}`,
  })
}

export const _sql = sql
