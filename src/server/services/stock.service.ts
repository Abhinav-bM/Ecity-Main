import { and, eq, sql } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branchStock,
  deviceEvent,
  deviceUnit,
  stockLedger,
  type DeviceStatus,
} from '@/server/db/schema'
import { AppError } from '@/server/http'

/**
 * The stock primitives. Every module from M3 onward moves stock through these
 * functions and never by touching the tables directly.
 *
 * Two invariants they exist to guarantee (docs/02 §2.2 rules 3 and 5):
 *   - a quantity change always writes a stock_ledger row
 *   - a device status change always writes a device_event row
 *
 * Both take an optional transaction, because a stock movement must commit or
 * roll back with the document that caused it - never separately.
 */

type MovementType = (typeof stockLedger.$inferInsert)['movement']
type EventType = (typeof deviceEvent.$inferInsert)['eventType']

export type StockContext = {
  businessId: number
  actorId?: number | null
  refType?: string
  refId?: number
  note?: string
  occurredAt?: Date
}

/* ------------------------------------------- non-serialised (accessories) - */

/**
 * Move accessory stock by a signed delta and record why.
 *
 * The UPDATE is conditional on the resulting quantity staying >= 0, so two
 * concurrent sales of the last unit cannot both succeed: the loser changes no
 * rows and is rejected. The database CHECK is the second line of defence.
 */
export async function moveStock(
  ctx: StockContext,
  input: {
    productId: number
    branchId: number
    delta: number
    movement: MovementType
  },
  tx: DbOrTx = db,
): Promise<{ quantityAfter: number }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AppError('Stock movement must be a non-zero whole number.', 422, 'INVALID_DELTA')
  }

  // Create the row on first use so callers never have to think about it.
  await tx
    .insert(branchStock)
    .values({ productId: input.productId, branchId: input.branchId, quantity: 0 })
    .onConflictDoNothing()

  const updated = await tx
    .update(branchStock)
    .set({
      quantity: sql`${branchStock.quantity} + ${input.delta}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(branchStock.productId, input.productId),
        eq(branchStock.branchId, input.branchId),
        // The guard: refuse rather than go negative.
        sql`${branchStock.quantity} + ${input.delta} >= 0`,
      ),
    )
    .returning({ quantity: branchStock.quantity })

  const row = updated[0]
  if (!row) {
    throw new AppError(
      'Not enough stock at this branch to complete the movement.',
      409,
      'INSUFFICIENT_STOCK',
      { productId: input.productId, branchId: input.branchId, requested: input.delta },
    )
  }

  await tx.insert(stockLedger).values({
    businessId: ctx.businessId,
    productId: input.productId,
    branchId: input.branchId,
    movement: input.movement,
    delta: input.delta,
    quantityAfter: row.quantity,
    refType: ctx.refType ?? null,
    refId: ctx.refId ?? null,
    note: ctx.note ?? null,
    actorId: ctx.actorId ?? null,
    occurredAt: ctx.occurredAt ?? new Date(),
  })

  return { quantityAfter: row.quantity }
}

export const increaseStock = (
  ctx: StockContext,
  input: { productId: number; branchId: number; quantity: number; movement: MovementType },
  tx: DbOrTx = db,
) => moveStock(ctx, { ...input, delta: Math.abs(input.quantity) }, tx)

export const decreaseStock = (
  ctx: StockContext,
  input: { productId: number; branchId: number; quantity: number; movement: MovementType },
  tx: DbOrTx = db,
) => moveStock(ctx, { ...input, delta: -Math.abs(input.quantity) }, tx)

export async function getStock(productId: number, branchId: number, tx: DbOrTx = db) {
  const rows = await tx
    .select()
    .from(branchStock)
    .where(and(eq(branchStock.productId, productId), eq(branchStock.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

/* ----------------------------------------------- serialised (device units) - */

/**
 * Append one event to a device's history. Called by every function that
 * touches a device, which is what makes M9's IMEI timeline complete.
 *
 * `seq` is allocated from the device's current maximum inside the same
 * statement, so two concurrent writers cannot produce the same sequence -
 * the unique index on (device_id, seq) would reject the second anyway.
 */
export async function appendDeviceEvent(
  ctx: StockContext,
  input: {
    deviceId: number
    eventType: EventType
    branchId?: number | null
    fromBranchId?: number | null
    toBranchId?: number | null
    payload?: Record<string, unknown>
  },
  tx: DbOrTx = db,
): Promise<void> {
  await tx.insert(deviceEvent).values({
    deviceId: input.deviceId,
    seq: sql`(select coalesce(max(seq), 0) + 1 from device_event where device_id = ${input.deviceId})`,
    eventType: input.eventType,
    occurredAt: ctx.occurredAt ?? new Date(),
    branchId: input.branchId ?? null,
    fromBranchId: input.fromBranchId ?? null,
    toBranchId: input.toBranchId ?? null,
    refType: ctx.refType ?? null,
    refId: ctx.refId ?? null,
    actorId: ctx.actorId ?? null,
    payload: input.payload ?? {},
  })
}

/**
 * Legal status transitions. Kept as data rather than scattered `if`s so the
 * whole lifecycle can be read - and tested - in one place (PRD §5.2).
 */
const ALLOWED_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  IN_STOCK: ['RESERVED', 'SOLD', 'SOLD_PENDING_IMPORT', 'IN_TRANSIT', 'DAMAGED', 'LOST', 'REPAIR'],
  RESERVED: ['IN_STOCK', 'SOLD', 'SOLD_PENDING_IMPORT'],
  SOLD: ['RETURNED'],
  SOLD_PENDING_IMPORT: ['SOLD', 'RETURNED', 'IN_STOCK'],
  // A returned device is inspected before it can be sold again (FR-5.7).
  RETURNED: ['IN_STOCK', 'DAMAGED', 'REPAIR', 'LOST'],
  IN_TRANSIT: ['IN_STOCK', 'LOST'],
  DAMAGED: ['REPAIR', 'IN_STOCK', 'LOST'],
  REPAIR: ['IN_STOCK', 'DAMAGED', 'LOST'],
  LOST: ['IN_STOCK'],
}

export function canTransition(from: DeviceStatus, to: DeviceStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Change a device's status, guarding the transition and appending the event.
 *
 * The UPDATE is conditional on the current status, so two tills cannot both
 * sell the same handset: the second changes no rows and is refused
 * (docs/03 §4.6).
 */
export async function setDeviceStatus(
  ctx: StockContext,
  input: {
    deviceId: number
    expectedStatus: DeviceStatus
    nextStatus: DeviceStatus
    eventType: EventType
    branchId?: number | null
    toBranchId?: number | null
    payload?: Record<string, unknown>
  },
  tx: DbOrTx = db,
): Promise<void> {
  if (!canTransition(input.expectedStatus, input.nextStatus)) {
    throw new AppError(
      `A device cannot go from ${input.expectedStatus} to ${input.nextStatus}.`,
      422,
      'INVALID_TRANSITION',
    )
  }

  const updated = await tx
    .update(deviceUnit)
    .set({
      status: input.nextStatus,
      ...(input.toBranchId !== undefined ? { currentBranchId: input.toBranchId } : {}),
      updatedAt: new Date(),
      updatedBy: ctx.actorId ?? null,
    })
    .where(and(eq(deviceUnit.id, input.deviceId), eq(deviceUnit.status, input.expectedStatus)))
    .returning({ id: deviceUnit.id, branchId: deviceUnit.currentBranchId })

  const row = updated[0]
  if (!row) {
    throw new AppError(
      'This device is no longer available — someone else may have just changed it.',
      409,
      'DEVICE_CONFLICT',
      { deviceId: input.deviceId, expected: input.expectedStatus },
    )
  }

  await appendDeviceEvent(
    ctx,
    {
      deviceId: input.deviceId,
      eventType: input.eventType,
      branchId: input.branchId ?? row.branchId,
      toBranchId: input.toBranchId ?? null,
      payload: { from: input.expectedStatus, to: input.nextStatus, ...input.payload },
    },
    tx,
  )
}

/** The default channel for a main type (PRD FR-38.1). NEW is billed elsewhere. */
export function defaultSalesChannel(mainType: string): 'ECITY' | 'EXTERNAL' {
  return mainType === 'NEW' ? 'EXTERNAL' : 'ECITY'
}
