import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  branch,
  customer,
  deviceEvent,
  purchase,
  sale,
  saleItem,
  salesReturn,
  stockTransfer,
  supplier,
} from '@/server/db/schema'
import type { AuthUser } from '@/server/auth/permissions'
import { saleReceivedSql } from './customer-ledger.service'
import { salePaymentStatus } from './sale.service'

/**
 * One device's whole life (PRD FR-30.5, FR-30.6).
 *
 * `device_event` is append-only and ordered, so the timeline is a read of that
 * one table joined out to the documents it points at. Nothing is reconstructed
 * and nothing is inferred - if it is not an event, it did not happen.
 *
 * FR-30.6 wants the chain traceable end to end: Purchase → Seller → Branch →
 * Transfers → Sale → Customer → Return/Repair/Other. That means every entry
 * needs a working link to its source document, which is the whole job here:
 * the events carry `ref_type` and `ref_id`, and this resolves them in one
 * round trip per document type rather than one per event.
 */

export type TimelineEntry = {
  id: number
  seq: number
  eventType: string
  occurredAt: Date
  /** Human sentence for the row: "Sold on INV/MAIN/2026/000123 to Anil". */
  summary: string
  /** Where this happened, and where it went if it moved. */
  branchName: string | null
  fromBranchName: string | null
  toBranchName: string | null
  /** The document behind it, if there is one (FR-30.6). */
  link: { href: string; label: string } | null
  actorName: string | null
  payload: Record<string, unknown>
}

const EVENT_LABEL: Record<string, string> = {
  PURCHASED: 'Purchased',
  RECEIVED: 'Received',
  TRANSFERRED_OUT: 'Sent to another branch',
  TRANSFERRED_IN: 'Received at branch',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  RETURNED: 'Returned by the customer',
  INSPECTED: 'Inspected',
  RECLASSIFIED: 'Reclassified',
  REPAIRED: 'Repaired',
  DAMAGED: 'Marked damaged',
  LOST: 'Marked lost',
  ADJUSTED: 'Adjusted',
  VOIDED: 'Voided',
}

/**
 * Resolve every document the events point at, in one query per type.
 *
 * A device with fifty events would otherwise make fifty round trips, which is
 * exactly the < 1.5 s target in PRD §9.1 missed for no reason.
 */
async function resolveDocuments(events: (typeof deviceEvent.$inferSelect)[]) {
  const idsOf = (refType: string) =>
    [
      ...new Set(
        events
          .filter((e) => e.refType === refType && e.refId !== null)
          .map((e) => e.refId as number),
      ),
    ]

  const purchaseIds = idsOf('purchase')
  const saleIds = idsOf('sale')
  const returnIds = idsOf('sales_return')
  const transferIds = idsOf('stock_transfer')

  const [purchases, sales, returns, transfers] = await Promise.all([
    purchaseIds.length
      ? db
          .select({
            id: purchase.id,
            number: purchase.purchaseNumber,
            supplierName: supplier.name,
          })
          .from(purchase)
          .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
          .where(inArray(purchase.id, purchaseIds))
      : [],
    saleIds.length
      ? db
          .select({
            id: sale.id,
            number: sale.invoiceNumber,
            customerName: customer.name,
            totalPaise: sale.totalPaise,
          })
          .from(sale)
          .leftJoin(customer, eq(customer.id, sale.customerId))
          .where(inArray(sale.id, saleIds))
      : [],
    returnIds.length
      ? db
          .select({ id: salesReturn.id, number: salesReturn.returnNumber })
          .from(salesReturn)
          .where(inArray(salesReturn.id, returnIds))
      : [],
    transferIds.length
      ? db
          .select({ id: stockTransfer.id, number: stockTransfer.transferNumber })
          .from(stockTransfer)
          .where(inArray(stockTransfer.id, transferIds))
      : [],
  ])

  return {
    purchase: new Map(purchases.map((p) => [p.id, p])),
    sale: new Map(sales.map((s) => [s.id, s])),
    sales_return: new Map(returns.map((r) => [r.id, r])),
    stock_transfer: new Map(transfers.map((t) => [t.id, t])),
  }
}

export async function deviceTimeline(
  _actor: AuthUser,
  deviceId: number,
): Promise<TimelineEntry[]> {
  const events = await db
    .select()
    .from(deviceEvent)
    .where(eq(deviceEvent.deviceId, deviceId))
    .orderBy(asc(deviceEvent.seq))

  if (events.length === 0) return []

  // Branch names for every branch any event touched, in one query.
  const branchIds = [
    ...new Set(
      events
        .flatMap((e) => [e.branchId, e.fromBranchId, e.toBranchId])
        .filter((v): v is number => typeof v === 'number'),
    ),
  ]
  const branches = branchIds.length
    ? await db
        .select({ id: branch.id, name: branch.name })
        .from(branch)
        .where(inArray(branch.id, branchIds))
    : []
  const branchName = new Map(branches.map((b) => [b.id, b.name]))

  const docs = await resolveDocuments(events)

  return events.map((e) => {
    const label = EVENT_LABEL[e.eventType] ?? e.eventType
    const from = e.fromBranchId ? (branchName.get(e.fromBranchId) ?? null) : null
    const to = e.toBranchId ? (branchName.get(e.toBranchId) ?? null) : null
    const here = e.branchId ? (branchName.get(e.branchId) ?? null) : null

    let summary = label
    let link: TimelineEntry['link'] = null

    if (e.refType === 'purchase' && e.refId) {
      const p = docs.purchase.get(e.refId)
      if (p) {
        // FR-30.6: Purchase → Seller. The supplier is part of the chain.
        summary = `${label} from ${p.supplierName} on ${p.number}`
        link = { href: `/purchases/${p.id}`, label: p.number }
      }
    } else if (e.refType === 'sale' && e.refId) {
      const s = docs.sale.get(e.refId)
      if (s) {
        // FR-30.6: Sale → Customer.
        summary = `${label} on ${s.number}${s.customerName ? ` to ${s.customerName}` : ' to a walk-in'}`
        link = { href: `/sales/${s.id}`, label: s.number }
      }
    } else if (e.refType === 'sales_return' && e.refId) {
      const r = docs.sales_return.get(e.refId)
      if (r) {
        summary = `${label} on ${r.number}`
        link = { href: `/returns/${r.id}`, label: r.number }
      }
    } else if (e.refType === 'stock_transfer' && e.refId) {
      const t = docs.stock_transfer.get(e.refId)
      if (t) {
        summary =
          from && to
            ? `${label}: ${from} → ${to} on ${t.number}`
            : `${label} on ${t.number}`
        link = { href: `/transfers/${t.id}`, label: t.number }
      }
    } else if (e.refType === 'stock_adjustment' && e.refId) {
      summary = `${label}${here ? ` at ${here}` : ''}`
      link = { href: `/adjustments/${e.refId}`, label: 'Adjustment' }
    }

    /*
     * A reclassification says what actually changed, because "Reclassified"
     * on its own tells nobody anything - and correcting a device's main type
     * is exactly the kind of change someone will later want explained.
     */
    const payload = (e.payload ?? {}) as Record<string, unknown>
    if (e.eventType === 'RECLASSIFIED') {
      /*
       * updateDevice writes the change map straight in as the payload, so its
       * keys ARE the fields that moved. `from` and `to` are what
       * setDeviceStatus adds to every payload it touches, and are not fields.
       */
      const changed = Object.keys(payload).filter((k) => k !== 'from' && k !== 'to')
      if (changed.length) summary = `${label}: ${changed.join(', ')}`
    }
    if (e.eventType === 'INSPECTED' && typeof payload.grade === 'string') {
      summary = `${label} — graded ${String(payload.grade).toLowerCase()}`
    }

    return {
      id: e.id,
      seq: e.seq,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      summary,
      branchName: here,
      fromBranchName: from,
      toBranchName: to,
      link,
      actorName: null,
      payload,
    }
  })
}

/**
 * The commercial summary on the device page: what it cost, what it made.
 *
 * Read from the sale line rather than the device's own selling price, because
 * what a handset actually went for is what was billed, not what it was listed
 * at.
 */
export async function deviceCommercials(deviceId: number) {
  const rows = await db
    .select({
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt,
      customerId: sale.customerId,
      customerName: customer.name,
      customerPhone: customer.phone,
      lineTotalPaise: saleItem.lineTotalPaise,
      // FR-30.5 wants the discount given on this handset, not the bill total.
      discountPaise: saleItem.discountPaise,
      unitPricePaise: saleItem.unitPricePaise,
      branchName: branch.name,
      /*
       * Paid versus credit, for THIS bill. The shared expression, so the
       * device page cannot disagree with the sale page about whether it was
       * paid for.
       */
      saleTotalPaise: sale.totalPaise,
      paidPaise: saleReceivedSql(),
    })
    .from(saleItem)
    .innerJoin(sale, eq(sale.id, saleItem.saleId))
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .leftJoin(customer, eq(customer.id, sale.customerId))
    .where(and(eq(saleItem.deviceId, deviceId), sql`${sale.status} <> 'VOIDED'`))
    .orderBy(asc(sale.soldAt))

  return rows.map((r) => {
    const paid = BigInt(r.paidPaise)
    return {
      ...r,
      paidPaise: paid,
      creditPaise: r.saleTotalPaise - paid,
      paymentStatus: salePaymentStatus(r.saleTotalPaise, paid),
    }
  })
}

/**
 * FR-30.5, "current position": where it is now, and where it was before.
 *
 * The previous branch comes from the last move in the event log rather than a
 * column, because a column would only ever hold the last one and the log
 * already holds them all.
 */
export async function devicePosition(deviceId: number) {
  const moves = await db
    .select({
      fromBranchId: deviceEvent.fromBranchId,
      toBranchId: deviceEvent.toBranchId,
      occurredAt: deviceEvent.occurredAt,
    })
    .from(deviceEvent)
    .where(
      and(
        eq(deviceEvent.deviceId, deviceId),
        sql`${deviceEvent.eventType} in ('TRANSFERRED_IN', 'TRANSFERRED_OUT')`,
        sql`${deviceEvent.fromBranchId} is not null`,
      ),
    )
    .orderBy(desc(deviceEvent.seq))
    .limit(1)

  const previousBranchId = moves[0]?.fromBranchId ?? null
  if (previousBranchId === null) return { previousBranchName: null, movedAt: null }

  const row = (
    await db
      .select({ name: branch.name })
      .from(branch)
      .where(eq(branch.id, previousBranchId))
      .limit(1)
  )[0]

  return { previousBranchName: row?.name ?? null, movedAt: moves[0]?.occurredAt ?? null }
}
