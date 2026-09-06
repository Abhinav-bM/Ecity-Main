import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  purchase,
  supplier,
  supplierLedgerEntry,
  supplierPayment,
  supplierPaymentAllocation,
} from '@/server/db/schema'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * What the shop owes each supplier (PRD FR-14.1, FR-14.3).
 *
 * The balance is ALWAYS the sum of the append-only ledger - never a stored
 * counter (docs/03 §4.2). Positive means money is owed.
 */

export async function postLedgerEntry(
  tx: DbOrTx,
  input: {
    businessId: number
    supplierId: number
    branchId?: number | null
    entryType: (typeof supplierLedgerEntry.$inferInsert)['entryType']
    amountPaise: bigint
    refType?: string
    refId?: number
    note?: string
    actorId?: number | null
    occurredAt?: Date
  },
): Promise<void> {
  await tx.insert(supplierLedgerEntry).values({
    businessId: input.businessId,
    supplierId: input.supplierId,
    branchId: input.branchId ?? null,
    entryType: input.entryType,
    amountPaise: input.amountPaise,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
    actorId: input.actorId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  })
}

export async function supplierBalance(supplierId: number, tx: DbOrTx = db): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierLedgerEntry.amountPaise}), 0)` })
    .from(supplierLedgerEntry)
    .where(eq(supplierLedgerEntry.supplierId, supplierId))
  return BigInt(rows[0]?.total ?? '0')
}

/** How much of one purchase has been settled (PRD FR-5.12). */
export async function purchasePaidPaise(purchaseId: number, tx: DbOrTx = db): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierPaymentAllocation.amountPaise}), 0)` })
    .from(supplierPaymentAllocation)
    .innerJoin(supplierPayment, eq(supplierPayment.id, supplierPaymentAllocation.paymentId))
    .where(
      and(
        eq(supplierPaymentAllocation.purchaseId, purchaseId),
        // A voided payment settles nothing.
        isNull(supplierPayment.voidedAt),
      ),
    )
  return BigInt(rows[0]?.total ?? '0')
}

export function paymentStatusFor(totalPaise: bigint, paidPaise: bigint) {
  if (paidPaise <= 0n) return 'UNPAID' as const
  if (paidPaise >= totalPaise) return 'PAID' as const
  return 'PARTIAL' as const
}

export type SupplierOutstanding = {
  supplierId: number
  supplierName: string
  company: string | null
  phone: string | null
  balancePaise: bigint
  purchaseCount: number
  lastPurchaseAt: Date | null
}

/**
 * PRD FR-14.3 — supplier-wise outstanding, business-wide.
 *
 * Paged in memory: the balance comes from a grouped ledger sum joined to
 * purchase counts, and the list grows with every supplier the shop has ever
 * owed. Rendering all of them was the problem, not the query.
 */
export async function supplierOutstanding(
  actor: AuthUser,
  page = 1,
  pageSize = 25,
): Promise<{
  rows: SupplierOutstanding[]
  total: number
  page: number
  pageSize: number
  totalOwedPaise: bigint
}> {
  const rows = await db
    .select({
      supplierId: supplier.id,
      supplierName: supplier.name,
      company: supplier.company,
      phone: supplier.phone,
      balance: sql<string>`coalesce(sum(${supplierLedgerEntry.amountPaise}), 0)`,
    })
    .from(supplier)
    .leftJoin(supplierLedgerEntry, eq(supplierLedgerEntry.supplierId, supplier.id))
    .where(eq(supplier.businessId, actor.businessId))
    .groupBy(supplier.id, supplier.name, supplier.company, supplier.phone)

  const counts = await db
    .select({
      supplierId: purchase.supplierId,
      n: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${purchase.purchaseDate})`,
    })
    .from(purchase)
    .where(and(eq(purchase.businessId, actor.businessId), eq(purchase.status, 'CONFIRMED')))
    .groupBy(purchase.supplierId)

  const byId = new Map(counts.map((c) => [c.supplierId, c]))

  const all = rows
    .map((r) => ({
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      company: r.company,
      phone: r.phone,
      balancePaise: BigInt(r.balance),
      purchaseCount: byId.get(r.supplierId)?.n ?? 0,
      lastPurchaseAt: byId.get(r.supplierId)?.last ?? null,
    }))
    .filter((r) => r.balancePaise !== 0n || r.purchaseCount > 0)
    .sort((a, b) => Number(b.balancePaise - a.balancePaise))

  // Owed in total across every supplier, not just this page.
  const totalOwedPaise = all.reduce((sum, r) => sum + r.balancePaise, 0n)
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize

  return {
    rows: all.slice(start, start + pageSize),
    total: all.length,
    page: safePage,
    pageSize,
    totalOwedPaise,
  }
}

/** The supplier profile's history tab (PRD FR-5.11). */
export async function supplierHistory(actor: AuthUser, supplierId: number) {
  const [purchases, payments, balance] = await Promise.all([
    db
      .select({
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
        totalPaise: purchase.totalPaise,
      })
      .from(purchase)
      .where(and(eq(purchase.supplierId, supplierId), eq(purchase.businessId, actor.businessId)))
      .orderBy(desc(purchase.purchaseDate))
      .limit(100),
    db
      .select()
      .from(supplierPayment)
      .where(
        and(
          eq(supplierPayment.supplierId, supplierId),
          eq(supplierPayment.businessId, actor.businessId),
        ),
      )
      .orderBy(desc(supplierPayment.paidOn))
      .limit(100),
    supplierBalance(supplierId),
  ])

  const paid = await Promise.all(purchases.map((p) => purchasePaidPaise(p.id)))
  return {
    balancePaise: balance,
    purchases: purchases.map((p, i) => ({
      ...p,
      paidPaise: paid[i]!,
      paymentStatus: paymentStatusFor(p.totalPaise, paid[i]!),
    })),
    payments,
  }
}
