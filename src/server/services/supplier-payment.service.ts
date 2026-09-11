import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  paymentMethod,
  purchase,
  supplierPayment,
  supplierPaymentAllocation,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'
import { assertBranchAcceptsTransactions } from './branch.service'
import { assertPartySelectable } from './party.service'
import { postLedgerEntry, purchasePaidPaise } from './supplier-ledger.service'
import { postByPaymentMethod } from './cash.service'

/**
 * Paying a supplier (PRD FR-14.2).
 *
 * A payment reduces the supplier balance and is allocated across specific
 * purchases, which is what lets each purchase report Paid / Partial / Unpaid
 * (FR-5.12). Unallocated payment is an advance and simply sits on the balance.
 */

export type PaymentInput = {
  supplierId: number
  branchId: number
  paymentMethodId: number
  amountPaise: bigint
  paidOn?: Date
  reference?: string
  notes?: string
  /** Oldest-first automatic allocation when not given explicitly. */
  allocations?: { purchaseId: number; amountPaise: bigint }[]
}

export async function recordSupplierPayment(
  actor: AuthUser,
  ctx: AuditContext,
  input: PaymentInput,
): Promise<{ id: number }> {
  await assertBranchAcceptsTransactions(actor, input.branchId)
  await assertPartySelectable(actor, 'supplier', input.supplierId)
  return db.transaction((tx) => recordSupplierPaymentIn(actor, ctx, input, tx))
}

/**
 * The same payment, inside a transaction somebody else owns.
 *
 * A purchase can be settled as it is entered (FR-5.12), and that payment has
 * to be part of the same transaction that confirmed the purchase - otherwise a
 * failure between the two leaves a bill the shop believes it has paid. The
 * branch and supplier checks are the caller's to make: `createPurchase` has
 * already made them for the same branch and supplier by the time it gets here.
 */
export async function recordSupplierPaymentIn(
  actor: AuthUser,
  ctx: AuditContext,
  input: PaymentInput,
  tx: DbOrTx,
): Promise<{ id: number }> {
  if (input.amountPaise <= 0n) {
    throw new AppError('A payment must be more than zero.', 422, 'BAD_AMOUNT')
  }

  const method = await tx
    .select({ id: paymentMethod.id, isActive: paymentMethod.isActive })
    .from(paymentMethod)
    .where(
      and(
        eq(paymentMethod.id, input.paymentMethodId),
        eq(paymentMethod.businessId, actor.businessId),
      ),
    )
    .limit(1)
  if (!method[0]?.isActive) {
    throw new AppError('That payment method is not available.', 422, 'BAD_METHOD')
  }

  const created = (
    await tx
      .insert(supplierPayment)
      .values({
        businessId: actor.businessId,
        supplierId: input.supplierId,
        branchId: input.branchId,
        paymentMethodId: input.paymentMethodId,
        amountPaise: input.amountPaise,
        paidOn: input.paidOn ?? new Date(),
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: actor.id,
      })
      .returning()
  )[0]!

  // M7 FR-11.2. Paying a supplier in cash takes money out of the till.
  await postByPaymentMethod(tx, {
    businessId: actor.businessId,
    branchId: input.branchId,
    paymentMethodId: input.paymentMethodId,
    movement: 'SUPPLIER_PAYMENT',
    amountPaise: -input.amountPaise,
    refType: 'supplier_payment',
    refId: created.id,
    occurredAt: created.paidOn,
    actorId: actor.id,
  })

  const allocations = input.allocations?.length
    ? input.allocations
    : await autoAllocate(actor, input.supplierId, input.amountPaise, tx)

  let allocated = 0n
  for (const a of allocations) {
    if (a.amountPaise <= 0n) continue

    /*
     * Lock the purchase before reading what is still owed on it. Without
     * this, two payments against the same supplier bill entered at once both
     * see the full amount outstanding and both allocate it, and the purchase
     * shows as paid twice - the same race as on the customer side.
     */
    await tx.execute(sql`select id from purchase where id = ${a.purchaseId} for update`)

    const target = await tx
      .select({ id: purchase.id, totalPaise: purchase.totalPaise, status: purchase.status })
      .from(purchase)
      .where(and(eq(purchase.id, a.purchaseId), eq(purchase.businessId, actor.businessId)))
      .limit(1)
    const row = target[0]
    if (!row) throw notFound('Purchase')
    if (row.status !== 'CONFIRMED') {
      throw new AppError('Only a confirmed purchase can be paid.', 422, 'NOT_CONFIRMED')
    }

    const alreadyPaid = await purchasePaidPaise(a.purchaseId, tx)
    const owing = row.totalPaise - alreadyPaid
    if (a.amountPaise > owing) {
      throw new AppError(
        'That allocation is more than the purchase still owes.',
        422,
        'OVER_ALLOCATED',
        { purchaseId: a.purchaseId, owingPaise: String(owing) },
      )
    }

    await tx.insert(supplierPaymentAllocation).values({
      paymentId: created.id,
      purchaseId: a.purchaseId,
      amountPaise: a.amountPaise,
    })
    allocated += a.amountPaise
  }

  if (allocated > input.amountPaise) {
    throw new AppError('Allocations exceed the payment amount.', 422, 'OVER_ALLOCATED')
  }

  // Negative: the debt goes down.
  await postLedgerEntry(tx, {
    businessId: actor.businessId,
    supplierId: input.supplierId,
    branchId: input.branchId,
    entryType: 'PAYMENT',
    amountPaise: -input.amountPaise,
    refType: 'supplier_payment',
    refId: created.id,
    note: input.reference?.trim() || null || undefined,
    actorId: actor.id,
  })

  await writeAudit(
    ctx,
    {
      action: 'CREATE',
      entityType: 'supplier_payment',
      entityId: created.id,
      summary: `Paid supplier ${Number(input.amountPaise) / 100} across ${allocations.length} purchase(s)`,
    },
    tx,
  )

  return { id: created.id }
}

/** Oldest unpaid purchase first — the usual way a shop settles a supplier. */
async function autoAllocate(
  actor: AuthUser,
  supplierId: number,
  amountPaise: bigint,
  tx: DbOrTx = db,
) {
  const open = await tx
    .select({ id: purchase.id, totalPaise: purchase.totalPaise })
    .from(purchase)
    .where(
      and(
        eq(purchase.supplierId, supplierId),
        eq(purchase.businessId, actor.businessId),
        eq(purchase.status, 'CONFIRMED'),
      ),
    )
    .orderBy(asc(purchase.purchaseDate), asc(purchase.id))

  const allocations: { purchaseId: number; amountPaise: bigint }[] = []
  let left = amountPaise
  for (const p of open) {
    if (left <= 0n) break
    const owing = p.totalPaise - (await purchasePaidPaise(p.id, tx))
    if (owing <= 0n) continue
    const take = owing < left ? owing : left
    allocations.push({ purchaseId: p.id, amountPaise: take })
    left -= take
  }
  return allocations
}

/** Voided, never deleted (docs/02 §2.2 rule 4). */
export async function voidSupplierPayment(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
) {
  const rows = await db
    .select()
    .from(supplierPayment)
    .where(and(eq(supplierPayment.id, id), eq(supplierPayment.businessId, actor.businessId)))
    .limit(1)
  const payment = rows[0]
  if (!payment) throw notFound('Payment')
  if (payment.voidedAt) throw new AppError('This payment is already voided.', 422, 'ALREADY_VOID')

  await db.transaction(async (tx) => {
    /*
     * Conditional on it not already being void, and it is the UPDATE that
     * decides - not the read above, which by now is a moment old. Two people
     * voiding the same payment (or one person double-clicking) would otherwise
     * both pass that check and both post a REVERSAL, crediting the supplier
     * twice for one payment. The loser changes no rows and is told so.
     */
    const voided = await tx
      .update(supplierPayment)
      .set({ voidedAt: new Date(), voidReason: reason.trim() })
      .where(and(eq(supplierPayment.id, id), isNull(supplierPayment.voidedAt)))
      .returning({ id: supplierPayment.id })
    if (!voided[0]) {
      throw new AppError('This payment is already voided.', 422, 'ALREADY_VOID')
    }

    // The ledger is append-only, so the reversal is a new entry.
    await postLedgerEntry(tx, {
      businessId: actor.businessId,
      supplierId: payment.supplierId,
      branchId: payment.branchId,
      entryType: 'REVERSAL',
      amountPaise: payment.amountPaise,
      refType: 'supplier_payment',
      refId: id,
      note: `Voided: ${reason.trim()}`,
      actorId: actor.id,
    })

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'supplier_payment',
        entityId: id,
        summary: `Voided supplier payment: ${reason.trim()}`,
      },
      tx,
    )
  })
}

/** Open purchases for the payment screen, oldest first. */
export async function openPurchasesForSupplier(actor: AuthUser, supplierId: number) {
  const rows = await db
    .select({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      purchaseDate: purchase.purchaseDate,
      totalPaise: purchase.totalPaise,
    })
    .from(purchase)
    .where(
      and(
        eq(purchase.supplierId, supplierId),
        eq(purchase.businessId, actor.businessId),
        eq(purchase.status, 'CONFIRMED'),
      ),
    )
    .orderBy(asc(purchase.purchaseDate))

  // Aggregated separately rather than as a correlated subquery: joining
  // supplier_payment inside one made the outer "id" ambiguous.
  const paid = await Promise.all(rows.map((r) => purchasePaidPaise(r.id)))

  return rows
    .map((r, i) => ({ ...r, paidPaise: paid[i]! }))
    .filter((r) => r.totalPaise > r.paidPaise)
    .map((r) => ({ ...r, owingPaise: r.totalPaise - r.paidPaise }))
}
