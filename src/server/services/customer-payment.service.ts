import { and, asc, eq } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branch,
  business,
  customer,
  customerPayment,
  customerPaymentAllocation,
  paymentMethod,
  sale,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { assertBranchAcceptsTransactions } from './branch.service'
import { assertPartySelectable } from './party.service'
import { nextDocumentNumber } from './sequence.service'
import { postByPaymentMethod } from './cash.service'
import {
  postCustomerLedgerEntry,
  saleReceivedPaise,
  saleReceivedSql,
} from './customer-ledger.service'

/**
 * Collecting money a customer owes (PRD FR-7.3, FR-7.5).
 *
 * A payment reduces the customer's balance and is allocated across specific
 * invoices, which is what flips each one to Paid (FR-7.4). Money that is not
 * allocated is an advance: it still reduces the balance, it is just not tied
 * to a bill yet.
 *
 * The collecting branch is recorded on the payment, and it may differ from the
 * branch that made the sale (FR-7.5) - a customer can walk into any shop.
 */

export type CustomerPaymentInput = {
  customerId: number
  /** Where the money is being taken, not where the sale happened. */
  branchId: number
  paymentMethodId: number
  amountPaise: bigint
  receivedOn?: Date
  reference?: string
  notes?: string
  /** Oldest invoice first when not given explicitly. */
  allocations?: { saleId: number; amountPaise: bigint }[]
}

export async function recordCustomerPayment(
  actor: AuthUser,
  ctx: AuditContext,
  input: CustomerPaymentInput,
): Promise<{ id: number; receiptNumber: string }> {
  if (input.amountPaise <= 0n) {
    throw new AppError('A payment must be more than zero.', 422, 'BAD_AMOUNT')
  }
  await assertBranchAcceptsTransactions(actor, input.branchId)
  await assertPartySelectable(actor, 'customer', input.customerId)

  const method = (
    await db
      .select({ id: paymentMethod.id, isActive: paymentMethod.isActive })
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

  return db.transaction(async (tx) => {
    const series = await receiptSeriesFor(tx, actor.businessId, input.branchId)
    const receiptNumber = await nextDocumentNumber(tx, {
      businessId: actor.businessId,
      kind: 'customer_receipt',
      branchId: series.branchId,
      prefix: series.prefix,
    })

    const created = (
      await tx
        .insert(customerPayment)
        .values({
          businessId: actor.businessId,
          customerId: input.customerId,
          branchId: input.branchId,
          paymentMethodId: input.paymentMethodId,
          receiptNumber,
          amountPaise: input.amountPaise,
          receivedOn: input.receivedOn ?? new Date(),
          reference: input.reference?.trim() || null,
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!

    /*
     * M7 FR-11.2. A customer clearing their tab in cash puts money in the
     * till, so the drawer has to see it or the day will not reconcile.
     */
    await postByPaymentMethod(tx, {
      businessId: actor.businessId,
      branchId: input.branchId,
      paymentMethodId: input.paymentMethodId,
      movement: 'CUSTOMER_PAYMENT',
      amountPaise: input.amountPaise,
      refType: 'customer_payment',
      refId: created.id,
      note: receiptNumber,
      occurredAt: created.receivedOn,
      actorId: actor.id,
    })

    const allocations = input.allocations?.length
      ? input.allocations
      : await autoAllocate(actor, input.customerId, input.amountPaise, tx)

    let allocated = 0n
    for (const a of allocations) {
      if (a.amountPaise <= 0n) continue

      const target = (
        await tx
          .select({ id: sale.id, totalPaise: sale.totalPaise, status: sale.status })
          .from(sale)
          .where(
            and(
              eq(sale.id, a.saleId),
              eq(sale.businessId, actor.businessId),
              eq(sale.customerId, input.customerId),
            ),
          )
          .limit(1)
      )[0]
      if (!target) throw notFound('Sale')
      if (target.status !== 'COMPLETED') {
        throw new AppError('That bill is not open for payment.', 422, 'NOT_OPEN')
      }

      const already = await saleReceivedPaise(a.saleId, tx)
      const owing = target.totalPaise - already
      if (a.amountPaise > owing) {
        throw new AppError(
          'That allocation is more than the invoice still owes.',
          422,
          'OVER_ALLOCATED',
          { saleId: a.saleId, owingPaise: String(owing) },
        )
      }

      await tx.insert(customerPaymentAllocation).values({
        paymentId: created.id,
        saleId: a.saleId,
        amountPaise: a.amountPaise,
      })
      allocated += a.amountPaise
    }

    if (allocated > input.amountPaise) {
      throw new AppError('Allocations exceed the payment amount.', 422, 'OVER_ALLOCATED')
    }

    // Negative: the customer owes less.
    await postCustomerLedgerEntry(tx, {
      businessId: actor.businessId,
      customerId: input.customerId,
      branchId: input.branchId,
      entryType: 'PAYMENT',
      amountPaise: -input.amountPaise,
      refType: 'customer_payment',
      refId: created.id,
      note: input.reference?.trim() || null,
      actorId: actor.id,
      occurredAt: created.receivedOn,
    })

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'customer_payment',
        entityId: created.id,
        summary: `Collected ${receiptNumber} across ${allocations.length} invoice(s)`,
      },
      tx,
    )

    return { id: created.id, receiptNumber }
  })
}

/** Receipts follow the branch's own series where it has one, like invoices. */
async function receiptSeriesFor(
  tx: Parameters<typeof nextDocumentNumber>[0],
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
    ? { prefix: `${row.branchPrefix}-RCPT-`, branchId }
    : { prefix: `${row.businessPrefix}-RCPT-`, branchId: null }
}

/** Oldest open invoice first — how a shop actually clears a customer's tab. */
async function autoAllocate(
  actor: AuthUser,
  customerId: number,
  amountPaise: bigint,
  tx: DbOrTx,
) {
  // Must run on the caller's transaction. Querying the pool from inside an
  // open transaction deadlocks under concurrency: the outer transaction holds
  // a connection while waiting for a second one that will never come free.
  const open = await openSalesForCustomer(actor, customerId, tx)

  const allocations: { saleId: number; amountPaise: bigint }[] = []
  let left = amountPaise
  for (const s of open) {
    if (left <= 0n) break
    const take = s.owingPaise < left ? s.owingPaise : left
    allocations.push({ saleId: s.id, amountPaise: take })
    left -= take
  }
  return allocations
}

/** Open invoices for the collection screen, oldest first (PRD FR-7.3). */
export async function openSalesForCustomer(
  actor: AuthUser,
  customerId: number,
  tx: DbOrTx = db,
) {
  // One query with the shared "received" expression rather than two per sale:
  // a customer with a long tab would otherwise cost dozens of round trips.
  const rows = await tx
    .select({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt,
      dueDate: sale.dueDate,
      totalPaise: sale.totalPaise,
      branchName: branch.name,
      receivedPaise: saleReceivedSql(),
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(
      and(
        eq(sale.customerId, customerId),
        eq(sale.businessId, actor.businessId),
        eq(sale.status, 'COMPLETED'),
      ),
    )
    .orderBy(asc(sale.soldAt), asc(sale.id))

  // Deliberately not branch-scoped: a customer settles their whole tab at
  // whichever shop they walk into (FR-7.5).
  return rows
    .map((r) => ({ ...r, receivedPaise: BigInt(r.receivedPaise) }))
    .filter((r) => r.totalPaise > r.receivedPaise)
    .map((r) => ({ ...r, owingPaise: r.totalPaise - r.receivedPaise }))
}

/** Voided, never deleted (docs/02 §2.2 rule 4). */
export async function voidCustomerPayment(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
) {
  const payment = (
    await db
      .select()
      .from(customerPayment)
      .where(and(eq(customerPayment.id, id), eq(customerPayment.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!payment) throw notFound('Receipt')
  if (payment.voidedAt) throw conflict('This receipt is already voided.')

  await db.transaction(async (tx) => {
    await tx
      .update(customerPayment)
      .set({ voidedAt: new Date(), voidReason: reason.trim() })
      .where(eq(customerPayment.id, id))

    // The ledger is append-only, so the reversal is a new entry rather than
    // an edit. The allocations stay: they are what the receipt claimed, and
    // saleReceivedPaise already ignores a voided payment.
    await postCustomerLedgerEntry(tx, {
      businessId: actor.businessId,
      customerId: payment.customerId,
      branchId: payment.branchId,
      entryType: 'REVERSAL',
      amountPaise: payment.amountPaise,
      refType: 'customer_payment',
      refId: id,
      note: `Voided: ${reason.trim()}`,
      actorId: actor.id,
    })

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'customer_payment',
        entityId: id,
        summary: `Voided receipt ${payment.receiptNumber}: ${reason.trim()}`,
      },
      tx,
    )
  })
}

/** One receipt, for the printable page. */
export async function getCustomerPayment(actor: AuthUser, id: number) {
  const row = (
    await db
      .select({
        payment: customerPayment,
        customerName: customer.name,
        customerPhone: customer.phone,
        branchName: branch.name,
        branchCode: branch.code,
        methodName: paymentMethod.name,
      })
      .from(customerPayment)
      .innerJoin(customer, eq(customer.id, customerPayment.customerId))
      .innerJoin(branch, eq(branch.id, customerPayment.branchId))
      .innerJoin(paymentMethod, eq(paymentMethod.id, customerPayment.paymentMethodId))
      .where(and(eq(customerPayment.id, id), eq(customerPayment.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Receipt')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.payment.branchId)) throw notFound('Receipt')

  const allocations = await db
    .select({
      id: customerPaymentAllocation.id,
      amountPaise: customerPaymentAllocation.amountPaise,
      invoiceNumber: sale.invoiceNumber,
      saleId: sale.id,
      soldAt: sale.soldAt,
    })
    .from(customerPaymentAllocation)
    .innerJoin(sale, eq(sale.id, customerPaymentAllocation.saleId))
    .where(eq(customerPaymentAllocation.paymentId, id))
    .orderBy(asc(sale.soldAt))

  const allocated = allocations.reduce((sum, a) => sum + a.amountPaise, 0n)
  return {
    ...row,
    allocations,
    allocatedPaise: allocated,
    /** Anything left over sits on the account as an advance. */
    advancePaise: row.payment.amountPaise - allocated,
  }
}
