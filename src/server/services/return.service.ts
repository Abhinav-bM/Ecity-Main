import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branch,
  business,
  customer,
  deviceUnit,
  paymentMethod,
  product,
  refund,
  returnItem,
  sale,
  saleItem,
  salesReturn,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { increaseStock, setDeviceStatus } from './stock.service'
import { nextDocumentNumber } from './sequence.service'
import { postCustomerLedgerEntry, saleReceivedPaise } from './customer-ledger.service'
import { assertBranchAcceptsTransactions } from './branch.service'

/**
 * Returns and refunds (PRD FR-8.1 – FR-8.5).
 *
 * The rule that shapes this file, and the one most likely to be got wrong:
 * a returned handset NEVER goes straight back to sellable. It lands in
 * RETURNED and only an authorised inspection can release it (FR-8.2). A
 * counted accessory is different - there is no unit to inspect, so it goes
 * back into branch stock immediately.
 */

export type ReturnLineInput = {
  saleItemId: number
  /** For a counted product. A device line is always exactly one. */
  quantity: number
}

export type ReturnInput = {
  saleId: number
  /** Where the goods came back to; need not be where they were sold. */
  branchId: number
  lines: ReturnLineInput[]
  reason?: string
  notes?: string
  /** A restocking fee or similar, taken off what is given back. */
  deductionPaise?: bigint
  /**
   * How the money goes back. Omit to record the return without refunding -
   * useful when the goods are back but the money is settled later.
   */
  refund?: {
    method: 'PAYMENT_METHOD' | 'CUSTOMER_ACCOUNT'
    paymentMethodId?: number
    reference?: string
  }
  returnedAt?: Date
}

/** Returns follow the branch's own series where it has one, like invoices. */
async function returnSeriesFor(
  tx: DbOrTx,
  businessId: number,
  branchId: number,
): Promise<{ prefix: string; branchId: number | null }> {
  const row = (
    await tx
      .select({ branchPrefix: branch.invoicePrefix, businessPrefix: business.invoicePrefix })
      .from(branch)
      .innerJoin(business, eq(business.id, branch.businessId))
      .where(eq(branch.id, branchId))
      .limit(1)
  )[0]
  if (!row) throw notFound('Branch')

  return row.branchPrefix
    ? { prefix: `${row.branchPrefix}-RET-`, branchId }
    : { prefix: `${row.businessPrefix}-RET-`, branchId: null }
}

/** How much of one sale line has already come back on earlier returns. */
export async function alreadyReturnedQty(saleItemId: number, tx: DbOrTx = db): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`coalesce(sum(${returnItem.quantity}), 0)::int` })
    .from(returnItem)
    .innerJoin(salesReturn, eq(salesReturn.id, returnItem.returnId))
    .where(and(eq(returnItem.saleItemId, saleItemId), sql`${salesReturn.voidedAt} is null`))
  return rows[0]?.n ?? 0
}

export async function createReturn(
  actor: AuthUser,
  ctx: AuditContext,
  input: ReturnInput,
): Promise<{ id: number; returnNumber: string }> {
  if (input.lines.length === 0) {
    throw new AppError('Choose at least one item to return.', 422, 'NO_LINES')
  }
  await assertBranchAcceptsTransactions(actor, input.branchId)

  return db.transaction(async (tx) => {
    const saleRow = (
      await tx
        .select()
        .from(sale)
        .where(and(eq(sale.id, input.saleId), eq(sale.businessId, actor.businessId)))
        .limit(1)
    )[0]
    if (!saleRow) throw notFound('Sale')
    if (saleRow.status !== 'COMPLETED') {
      throw new AppError('That bill is not open for returns.', 422, 'NOT_OPEN')
    }

    const items = await tx
      .select()
      .from(saleItem)
      .where(eq(saleItem.saleId, input.saleId))
    const itemById = new Map(items.map((i) => [i.id, i]))

    /*
     * Validate every line before writing anything: a half-applied return
     * would leave stock and money disagreeing with each other.
     */
    const prepared = []
    for (const line of input.lines) {
      const item = itemById.get(line.saleItemId)
      if (!item) throw new AppError('That line is not on this bill.', 422, 'BAD_LINE')
      if (line.quantity <= 0) {
        throw new AppError('A return line must be at least one.', 422, 'BAD_QUANTITY')
      }

      const already = await alreadyReturnedQty(item.id, tx)
      const remaining = item.quantity - already
      if (line.quantity > remaining) {
        throw new AppError(
          `${item.description ?? 'That item'} has only ${remaining} left to return.`,
          422,
          'OVER_RETURNED',
          { saleItemId: item.id, remaining },
        )
      }
      if (item.deviceId && line.quantity !== 1) {
        throw new AppError('A handset is returned one at a time.', 422, 'BAD_QUANTITY')
      }

      // Refund the line at what the customer actually paid for it, pro rata
      // for a partial quantity, so returning 2 of 5 gives back 2/5 of the line.
      const share = (value: bigint) => (value * BigInt(line.quantity)) / BigInt(item.quantity)
      prepared.push({
        item,
        quantity: line.quantity,
        taxPaise: share(item.taxPaise),
        lineTotalPaise: share(item.lineTotalPaise),
      })
    }

    const subtotal = prepared.reduce((sum, p) => sum + (p.lineTotalPaise - p.taxPaise), 0n)
    const tax = prepared.reduce((sum, p) => sum + p.taxPaise, 0n)
    const total = prepared.reduce((sum, p) => sum + p.lineTotalPaise, 0n)
    const deduction = input.deductionPaise ?? 0n
    if (deduction < 0n) throw new AppError('A deduction cannot be negative.', 422, 'BAD_DEDUCTION')
    if (deduction > total) {
      throw new AppError('The deduction is more than the goods are worth.', 422, 'BAD_DEDUCTION')
    }
    const refundable = total - deduction

    // FULL when every line on the bill comes back in this one return.
    const returnsWholeBill =
      items.length === prepared.length &&
      prepared.every((p) => p.quantity === p.item.quantity) &&
      (await Promise.all(items.map((i) => alreadyReturnedQty(i.id, tx)))).every((n) => n === 0)

    const series = await returnSeriesFor(tx, actor.businessId, input.branchId)
    const returnNumber = await nextDocumentNumber(tx, {
      businessId: actor.businessId,
      kind: 'sales_return',
      branchId: series.branchId,
      prefix: series.prefix,
    })

    const returnedAt = input.returnedAt ?? new Date()
    const created = (
      await tx
        .insert(salesReturn)
        .values({
          businessId: actor.businessId,
          saleId: input.saleId,
          branchId: input.branchId,
          customerId: saleRow.customerId,
          returnNumber,
          returnType: returnsWholeBill ? 'FULL' : 'PARTIAL',
          returnedAt,
          reason: input.reason?.trim() || null,
          subtotalPaise: subtotal,
          taxPaise: tax,
          totalPaise: total,
          deductionPaise: deduction,
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!

    for (const p of prepared) {
      await tx.insert(returnItem).values({
        returnId: created.id,
        saleItemId: p.item.id,
        productId: p.item.productId,
        deviceId: p.item.deviceId,
        description: p.item.description,
        identifierSnapshot: p.item.identifierSnapshot,
        quantity: p.quantity,
        unitPricePaise: p.item.unitPricePaise,
        taxPaise: p.taxPaise,
        lineTotalPaise: p.lineTotalPaise,
      })

      if (p.item.deviceId) {
        /*
         * PRD FR-8.2. The handset goes to RETURNED, NOT back to IN_STOCK.
         * It is not sellable again until someone with return.inspect grades
         * it. Main type and NEW CUT are untouched here - FR-8.4 requires them
         * to survive the return unchanged.
         */
        await setDeviceStatus(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'sales_return',
            refId: created.id,
          },
          {
            deviceId: p.item.deviceId,
            expectedStatus: 'SOLD',
            nextStatus: 'RETURNED',
            eventType: 'RETURNED',
            branchId: input.branchId,
            payload: { returnNumber, reason: input.reason?.trim() ?? null },
          },
          tx,
        )
      } else {
        // A counted accessory has no unit to inspect, so it goes straight
        // back on the shelf at the branch that received it.
        await increaseStock(
          { businessId: actor.businessId, actorId: actor.id, refType: 'sales_return', refId: created.id },
          {
            productId: p.item.productId,
            branchId: input.branchId,
            quantity: p.quantity,
            movement: 'RETURN',
          },
          tx,
        )
      }
    }

    /*
     * A refund cannot hand back more than the bill was actually settled by.
     *
     * Without this, goods bought on credit and returned unpaid would pay out
     * cash the shop never received - the customer keeps the debt AND takes the
     * money. The reversal below still clears the full value off their account,
     * so a part-paid bill returns the cash they gave and writes off the rest.
     *
     * "Settled by" is the shared expression, so cash at the counter, a later
     * collection and a handset taken in part-exchange all count.
     */
    const settledOnSale = await saleReceivedPaise(saleRow.id, tx)
    const refundedBefore = (
      await tx
        .select({ total: sql<string>`coalesce(sum(${refund.amountPaise}), 0)` })
        .from(refund)
        .innerJoin(salesReturn, eq(salesReturn.id, refund.returnId))
        .where(eq(salesReturn.saleId, saleRow.id))
    )[0]
    const refundCap = settledOnSale - BigInt(refundedBefore?.total ?? '0')
    /*
     * The cap is on money leaving the shop. Crediting the customer's account
     * is not a payout - it is the reversal already being posted below - so a
     * credit note is never capped, only a refund through a payment method.
     */
    const payable =
      input.refund?.method === 'PAYMENT_METHOD'
        ? refundCap <= 0n
          ? 0n
          : refundable < refundCap
            ? refundable
            : refundCap
        : refundable

    let refunded = 0n
    if (input.refund && payable > 0n) {
      if (input.refund.method === 'PAYMENT_METHOD') {
        if (!input.refund.paymentMethodId) {
          throw new AppError('Choose how the money is being given back.', 422, 'NO_METHOD')
        }
        const method = (
          await tx
            .select({ id: paymentMethod.id, isActive: paymentMethod.isActive })
            .from(paymentMethod)
            .where(
              and(
                eq(paymentMethod.id, input.refund.paymentMethodId),
                eq(paymentMethod.businessId, actor.businessId),
              ),
            )
            .limit(1)
        )[0]
        if (!method?.isActive) {
          throw new AppError('That payment method is not available.', 422, 'BAD_METHOD')
        }
      } else if (!saleRow.customerId) {
        throw new AppError(
          'A walk-in has no account to credit — refund to a payment method.',
          422,
          'NO_CUSTOMER',
        )
      }

      await tx.insert(refund).values({
        businessId: actor.businessId,
        returnId: created.id,
        branchId: input.branchId,
        method: input.refund.method,
        paymentMethodId:
          input.refund.method === 'PAYMENT_METHOD' ? input.refund.paymentMethodId! : null,
        amountPaise: payable,
        reference: input.refund.reference?.trim() || null,
        refundedAt: returnedAt,
        createdBy: actor.id,
      })
      refunded = payable

      await tx
        .update(salesReturn)
        .set({ refundedPaise: refunded })
        .where(eq(salesReturn.id, created.id))
    }

    /*
     * PRD FR-7.4 meets FR-8.5. A named customer's account always moves by the
     * value of the goods returned - they owe that much less. If the money went
     * out through a payment method as well, that is a second movement the
     * other way, because they received it.
     *
     * Getting this wrong in either direction is the classic returns bug:
     * refund the cash AND wipe the debt, and the shop pays twice.
     */
    if (saleRow.customerId) {
      await postCustomerLedgerEntry(tx, {
        businessId: actor.businessId,
        customerId: saleRow.customerId,
        branchId: input.branchId,
        entryType: 'REVERSAL',
        amountPaise: -refundable,
        refType: 'sales_return',
        refId: created.id,
        note: `Goods returned on ${returnNumber}`,
        actorId: actor.id,
        occurredAt: returnedAt,
      })

      if (refunded > 0n && input.refund?.method === 'PAYMENT_METHOD') {
        await postCustomerLedgerEntry(tx, {
          businessId: actor.businessId,
          customerId: saleRow.customerId,
          branchId: input.branchId,
          entryType: 'ADJUSTMENT',
          amountPaise: refunded,
          refType: 'sales_return',
          refId: created.id,
          note: `Refund paid out on ${returnNumber}`,
          actorId: actor.id,
          occurredAt: returnedAt,
        })
      }
    }

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'sales_return',
        entityId: created.id,
        summary: `Return ${returnNumber} against ${saleRow.invoiceNumber}`,
      },
      tx,
    )

    return { id: created.id, returnNumber }
  })
}

/* ------------------------------------------------------- inspection --- */

/** PRD FR-8.3. What each grade means for the handset's status. */
const GRADE_STATUS = {
  AVAILABLE: 'IN_STOCK',
  USED: 'IN_STOCK',
  DAMAGED: 'DAMAGED',
  REPAIR_REQUIRED: 'REPAIR',
} as const

export type InspectionGrade = keyof typeof GRADE_STATUS

/**
 * PRD FR-8.3. Grade a returned handset and release it, or hold it back.
 *
 * AVAILABLE and USED both return it to sellable stock; the difference is the
 * condition recorded against it, which the till shows so the salesperson knows
 * what they are selling.
 *
 * Main type and NEW CUT are deliberately NOT touched (FR-8.4). A returned
 * GLOBAL handset graded USED is still GLOBAL — condition and classification
 * are different facts. Changing the classification is `updateDevice`, which is
 * a separate, audited decision.
 */
export async function inspectDevice(
  actor: AuthUser,
  ctx: AuditContext,
  input: { deviceId: number; grade: InspectionGrade; notes?: string; branchId?: number },
): Promise<void> {
  const device = (
    await db
      .select({
        id: deviceUnit.id,
        status: deviceUnit.status,
        identifier: deviceUnit.primaryIdentifier,
        branchId: deviceUnit.currentBranchId,
        mainType: deviceUnit.mainType,
        isNewCut: deviceUnit.isNewCut,
      })
      .from(deviceUnit)
      .where(and(eq(deviceUnit.id, input.deviceId), eq(deviceUnit.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!device) throw notFound('Device')
  if (device.status !== 'RETURNED') {
    throw conflict(
      `${device.identifier ?? 'That device'} is not awaiting inspection (${device.status}).`,
    )
  }

  const nextStatus = GRADE_STATUS[input.grade]
  const branchId = input.branchId ?? device.branchId

  await db.transaction(async (tx) => {
    await setDeviceStatus(
      { businessId: actor.businessId, actorId: actor.id, refType: 'inspection', refId: input.deviceId },
      {
        deviceId: input.deviceId,
        expectedStatus: 'RETURNED',
        nextStatus,
        eventType: 'INSPECTED',
        branchId,
        payload: {
          grade: input.grade,
          notes: input.notes?.trim() ?? null,
          // Recorded so the M9 timeline shows the classification was carried
          // through the return rather than quietly changed.
          mainType: device.mainType,
          isNewCut: device.isNewCut,
        },
      },
      tx,
    )

    await tx
      .update(deviceUnit)
      .set({
        inspectionGrade: input.grade,
        inspectedAt: new Date(),
        inspectedBy: actor.id,
        inspectionNotes: input.notes?.trim() || null,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(deviceUnit.id, input.deviceId))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'device_unit',
        entityId: input.deviceId,
        summary: `Inspected ${device.identifier ?? `#${input.deviceId}`}: ${input.grade}`,
      },
      tx,
    )
  })
}

/** Handsets waiting to be graded — the inspection queue. */
export async function inspectionQueue(
  actor: AuthUser,
  branchId?: number | null,
  paging?: { page: number; pageSize: number },
) {
  const conditions: SQL[] = [
    eq(deviceUnit.businessId, actor.businessId),
    eq(deviceUnit.status, 'RETURNED'),
  ]
  const scope = branchScope(actor, branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${deviceUnit.currentBranchId} in ${scope.length ? scope : [-1]}`)
  }

  const rows = await db
    .select({
      id: deviceUnit.id,
      identifier: deviceUnit.primaryIdentifier,
      productName: product.name,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      colour: deviceUnit.colour,
      storage: deviceUnit.storage,
      batteryHealthPercent: deviceUnit.batteryHealthPercent,
      branchName: branch.name,
      updatedAt: deviceUnit.updatedAt,
    })
    .from(deviceUnit)
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
    .where(and(...conditions))
    // Oldest first: a queue is worked through, not browsed. Paged all the same,
    // so a queue nobody has cleared for a month still renders.
    .orderBy(asc(deviceUnit.updatedAt))
    .limit(paging ? paging.pageSize : 500)
    .offset(paging ? (paging.page - 1) * paging.pageSize : 0)

  const counted = await db
    .select({ n: sql<string>`count(*)` })
    .from(deviceUnit)
    .where(and(...conditions))

  return { rows, total: Number(counted[0]?.n ?? 0) }
}

/* ----------------------------------------------------------- reading --- */

export async function getReturn(actor: AuthUser, id: number) {
  const row = (
    await db
      .select({
        salesReturn,
        invoiceNumber: sale.invoiceNumber,
        customerName: customer.name,
        branchName: branch.name,
        branchCode: branch.code,
      })
      .from(salesReturn)
      .innerJoin(sale, eq(sale.id, salesReturn.saleId))
      .leftJoin(customer, eq(customer.id, salesReturn.customerId))
      .innerJoin(branch, eq(branch.id, salesReturn.branchId))
      .where(and(eq(salesReturn.id, id), eq(salesReturn.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Return')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.salesReturn.branchId)) throw notFound('Return')

  const [items, refunds] = await Promise.all([
    db.select().from(returnItem).where(eq(returnItem.returnId, id)).orderBy(asc(returnItem.id)),
    db
      .select({
        id: refund.id,
        method: refund.method,
        amountPaise: refund.amountPaise,
        reference: refund.reference,
        refundedAt: refund.refundedAt,
        methodName: paymentMethod.name,
      })
      .from(refund)
      .leftJoin(paymentMethod, eq(paymentMethod.id, refund.paymentMethodId))
      .where(eq(refund.returnId, id)),
  ])

  return { ...row, items, refunds }
}

export type ReturnFilters = { search?: string; branchId?: number; page: number; pageSize: number }

export async function listReturns(actor: AuthUser, filters: ReturnFilters) {
  const conditions: SQL[] = [eq(salesReturn.businessId, actor.businessId)]
  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${salesReturn.branchId} in ${scope.length ? scope : [-1]}`)
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      sql`(${salesReturn.returnNumber} ilike ${term} or ${sale.invoiceNumber} ilike ${term}
        or ${customer.name} ilike ${term})`,
    )
  }
  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: salesReturn.id,
        returnNumber: salesReturn.returnNumber,
        returnedAt: salesReturn.returnedAt,
        returnType: salesReturn.returnType,
        totalPaise: salesReturn.totalPaise,
        refundedPaise: salesReturn.refundedPaise,
        voidedAt: salesReturn.voidedAt,
        invoiceNumber: sale.invoiceNumber,
        saleId: sale.id,
        customerName: customer.name,
        branchName: branch.name,
      })
      .from(salesReturn)
      .innerJoin(sale, eq(sale.id, salesReturn.saleId))
      .leftJoin(customer, eq(customer.id, salesReturn.customerId))
      .innerJoin(branch, eq(branch.id, salesReturn.branchId))
      .where(where)
      .orderBy(desc(salesReturn.returnedAt), desc(salesReturn.id))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(salesReturn)
      .innerJoin(sale, eq(sale.id, salesReturn.saleId))
      .leftJoin(customer, eq(customer.id, salesReturn.customerId))
      .where(where),
  ])

  return {
    rows,
    total: totals[0]?.n ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

/** What is still returnable on a bill — what the return screen offers. */
export async function returnableLines(actor: AuthUser, saleId: number) {
  const saleRow = (
    await db
      .select()
      .from(sale)
      .where(and(eq(sale.id, saleId), eq(sale.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!saleRow) throw notFound('Sale')

  const items = await db
    .select()
    .from(saleItem)
    .where(eq(saleItem.saleId, saleId))
    .orderBy(asc(saleItem.id))

  const returned = await Promise.all(items.map((i) => alreadyReturnedQty(i.id)))
  return {
    sale: saleRow,
    lines: items.map((item, i) => ({
      ...item,
      returnedQty: returned[i]!,
      remainingQty: item.quantity - returned[i]!,
    })),
  }
}
