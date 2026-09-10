import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { normaliseStateCode, stateCodeFromGstin } from '@/lib/gst'
import { db } from '@/server/db'
import { business, deviceUnit, expenseCategory, paymentMethod, taxRate } from '@/server/db/schema'
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

  /*
   * Moving NEW stock between systems has to reach the stock already on the
   * shelf.
   *
   * Each device carries the channel it was booked in with, and the till
   * filters on that column — so changing this setting used to affect only
   * *future* handsets, and the shop would flip the switch, see nothing
   * change, and conclude it was broken. Which it was: "NEW stock is billed
   * here" is a statement about the shop, not about one delivery.
   *
   * Two limits, both deliberate:
   *
   *   - **Only what is still in stock.** A sold handset's channel is a record
   *     of where it was sold, and rewriting that would falsify history.
   *   - **Only devices still carrying the old default.** Anything set to a
   *     different channel by hand was somebody's decision about that
   *     particular unit, and a settings change should not quietly undo it.
   */
  const movedChannel =
    values.newStockSalesChannel !== undefined &&
    values.newStockSalesChannel !== before.newStockSalesChannel

  let restamped = 0
  if (movedChannel) {
    const changed = await db
      .update(deviceUnit)
      .set({ salesChannel: values.newStockSalesChannel!, updatedAt: new Date() })
      .where(
        and(
          eq(deviceUnit.businessId, actor.businessId),
          eq(deviceUnit.mainType, 'NEW'),
          eq(deviceUnit.status, 'IN_STOCK'),
          eq(deviceUnit.salesChannel, before.newStockSalesChannel),
        ),
      )
      .returning({ id: deviceUnit.id })
    restamped = changed.length
  }

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'business',
    entityId: actor.businessId,
    summary: movedChannel
      ? `Updated business profile — NEW stock now billed in ${values.newStockSalesChannel}, ${restamped} handset(s) in stock moved with it`
      : 'Updated business profile',
    changes: diff(before, values),
  })

  return { restamped }
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

/**
 * A method's `code` is derived from its name, not asked for.
 *
 * It is unique per business and shows in the settings list, but nothing in the
 * app ever branches on it - every decision that matters reads `type` instead
 * (the cash-drawer default below, the last-cash-method guard further down).
 * It was nonetheless a required field on the add form, which asked a shop
 * owner to invent `BANK_TRANSFER`-shaped identifiers for something they never
 * see used. The name is an answer they already have.
 */
function codeFromName(name: string) {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  // A name of nothing but punctuation still has to produce a valid code.
  return base.length >= 2 ? base : 'METHOD'
}

/** GPAY, then GPAY_2 - and the suffix has to fit the 20-character column. */
async function freeCode(businessId: number, wanted: string) {
  const taken = new Set(
    (
      await db
        .select({ code: paymentMethod.code })
        .from(paymentMethod)
        .where(eq(paymentMethod.businessId, businessId))
    ).map((r) => r.code),
  )
  if (!taken.has(wanted)) return wanted
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`
    const candidate = wanted.slice(0, 20 - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  throw conflict('Too many payment methods with similar names.')
}

export async function upsertPaymentMethod(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    id?: number
    /** Derived from the name when absent. Still accepted so a seed can pin one. */
    code?: string
    name: string
    type: (typeof paymentMethod.$inferInsert)['type']
    affectsCashDrawer?: boolean
    sortOrder?: number
  },
) {
  if (input.id) {
    // Scoped to the business: selecting by id alone let an admin of one shop
    // edit another shop's method, because the clash check below never matched
    // across businesses and so never stood in the way.
    const before = (
      await db
        .select()
        .from(paymentMethod)
        .where(and(eq(paymentMethod.id, input.id), eq(paymentMethod.businessId, actor.businessId)))
        .limit(1)
    )[0]
    if (!before) throw notFound('Payment method')

    // The code is the method's stable identifier and an edit never rewrites
    // it: renaming "GPay" to "Google Pay" must not move what it is called
    // underneath.
    const after = {
      name: input.name,
      type: input.type,
      affectsCashDrawer: input.affectsCashDrawer ?? input.type === 'CASH',
      sortOrder: input.sortOrder ?? before.sortOrder,
    }
    await db
      .update(paymentMethod)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(paymentMethod.id, input.id))
    await writeAudit(ctx, {
      action: 'UPDATE',
      entityType: 'payment_method',
      entityId: input.id,
      summary: `Updated payment method ${input.name}`,
      changes: diff(before, after),
    })
    return { id: input.id }
  }

  let code: string
  if (input.code) {
    // Supplied explicitly (the seed, an import): a clash is the caller's
    // mistake and is worth refusing rather than quietly renaming.
    const clash = await db
      .select({ id: paymentMethod.id })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.businessId, actor.businessId), eq(paymentMethod.code, input.code)))
      .limit(1)
    if (clash[0]) throw conflict('A payment method with this code already exists.')
    code = input.code
  } else {
    code = await freeCode(actor.businessId, codeFromName(input.name))
  }

  const created = (
    await db
      .insert(paymentMethod)
      .values({
        businessId: actor.businessId,
        code,
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
