import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  appUser,
  branch,
  branchStock,
  deviceUnit,
  product,
  stockAdjustment,
  type DeviceStatus,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { getStock, moveStock, setDeviceStatus } from './stock.service'

/**
 * Stock adjustments (PRD FR-28.1 – FR-28.3).
 *
 * An adjustment is the honest record of a difference between the shelf and the
 * system - not a way to make one disappear. It names the branch, the thing,
 * the reason, the person and the moment, and it is never edited afterwards:
 * a wrong adjustment is corrected by a second one, so both stay visible.
 */

export type AdjustmentReason = (typeof stockAdjustment.$inferInsert)['reason']

/** FR-28.3, and the device status each reason implies for a handset. */
const DEVICE_OUTCOME: Record<AdjustmentReason, DeviceStatus | null> = {
  DAMAGE: 'DAMAGED',
  LOSS: 'LOST',
  // A miscount is about quantities; for a device it means the record was
  // wrong about where it was, which the device edit handles, not this.
  MISCOUNT: null,
  DATA_ENTRY_ERROR: null,
}

export type AdjustmentInput = {
  branchId: number
  productId: number
  /** Set for a handset; omit to adjust an accessory count. */
  deviceId?: number | null
  reason: AdjustmentReason
  /** Accessories only. Signed: negative writes stock off. */
  quantityDelta?: number
  notes?: string
}

export async function createAdjustment(
  actor: AuthUser,
  ctx: AuditContext,
  input: AdjustmentInput,
): Promise<{ id: number }> {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(input.branchId)) throw notFound('Branch')

  return db.transaction(async (tx) => {
    if (input.deviceId) {
      const device = (
        await tx
          .select({
            id: deviceUnit.id,
            status: deviceUnit.status,
            branchId: deviceUnit.currentBranchId,
            productId: deviceUnit.productId,
            identifier: deviceUnit.primaryIdentifier,
            mainType: deviceUnit.mainType,
            isNewCut: deviceUnit.isNewCut,
          })
          .from(deviceUnit)
          .where(
            and(eq(deviceUnit.id, input.deviceId), eq(deviceUnit.businessId, actor.businessId)),
          )
          .limit(1)
      )[0]
      if (!device) throw notFound('Device')
      if (device.branchId !== input.branchId) {
        throw new AppError('That device is at a different branch.', 422, 'WRONG_BRANCH')
      }

      const next = DEVICE_OUTCOME[input.reason]
      if (!next) {
        throw new AppError(
          'Damage or loss are the reasons that apply to one handset. A miscount or a typo is corrected by editing the device.',
          422,
          'BAD_REASON',
        )
      }
      if (device.status === next) {
        throw conflict(`${device.identifier ?? 'That device'} is already ${next}.`)
      }

      const created = (
        await tx
          .insert(stockAdjustment)
          .values({
            businessId: actor.businessId,
            branchId: input.branchId,
            productId: device.productId,
            deviceId: device.id,
            reason: input.reason,
            deviceStatusBefore: device.status,
            deviceStatusAfter: next,
            // FR-28.2. Snapshotted, so a later reclassification cannot rewrite
            // what this adjustment said about the handset at the time.
            mainTypeSnapshot: device.mainType,
            isNewCutSnapshot: device.isNewCut,
            notes: input.notes?.trim() || null,
            createdBy: actor.id,
          })
          .returning({ id: stockAdjustment.id })
      )[0]!

      await setDeviceStatus(
        {
          businessId: actor.businessId,
          actorId: actor.id,
          refType: 'stock_adjustment',
          refId: created.id,
          note: input.notes?.trim(),
        },
        {
          deviceId: device.id,
          expectedStatus: device.status,
          nextStatus: next,
          eventType: next === 'DAMAGED' ? 'DAMAGED' : 'LOST',
          branchId: input.branchId,
          payload: { reason: input.reason, notes: input.notes?.trim() ?? null },
        },
        tx,
      )

      await writeAudit(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'stock_adjustment',
          entityId: created.id,
          summary:
            `${device.identifier ?? 'Device'} adjusted ${device.status} → ${next} ` +
            `(${input.reason})`,
        },
        tx,
      )

      return { id: created.id }
    }

    /* ---- an accessory count ---- */

    const delta = input.quantityDelta ?? 0
    if (!Number.isInteger(delta) || delta === 0) {
      throw new AppError('An adjustment of nothing changes nothing.', 422, 'BAD_DELTA')
    }

    const prod = (
      await tx
        .select({ id: product.id, isSerialised: product.isSerialised })
        .from(product)
        .where(and(eq(product.id, input.productId), eq(product.businessId, actor.businessId)))
        .limit(1)
    )[0]
    if (!prod) throw notFound('Product')
    if (prod.isSerialised) {
      throw new AppError(
        'A serialised product is adjusted one handset at a time, by IMEI.',
        422,
        'NEEDS_DEVICE',
      )
    }

    // getStock returns the row, or null when the branch has never held any.
    const before = (await getStock(input.productId, input.branchId, tx))?.quantity ?? 0

    const created = (
      await tx
        .insert(stockAdjustment)
        .values({
          businessId: actor.businessId,
          branchId: input.branchId,
          productId: input.productId,
          reason: input.reason,
          quantityDelta: delta,
          quantityBefore: before,
          quantityAfter: before + delta,
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
        })
        .returning({ id: stockAdjustment.id })
    )[0]!

    // The ledger entry is what the FR-21 movement report reads, so the
    // adjustment shows up there as well as in its own list.
    const { quantityAfter } = await moveStock(
      {
        businessId: actor.businessId,
        actorId: actor.id,
        refType: 'stock_adjustment',
        refId: created.id,
        note: input.notes?.trim(),
      },
      {
        productId: input.productId,
        branchId: input.branchId,
        delta,
        movement: 'ADJUSTMENT',
      },
      tx,
    )

    // moveStock is the authority on where the count landed; a concurrent sale
    // between the read above and the update would make our figure stale.
    await tx
      .update(stockAdjustment)
      .set({ quantityAfter })
      .where(eq(stockAdjustment.id, created.id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'stock_adjustment',
        entityId: created.id,
        summary: `Stock adjusted by ${delta > 0 ? '+' : ''}${delta} (${input.reason})`,
      },
      tx,
    )

    return { id: created.id }
  })
}

/* ------------------------------------------------------------ reading --- */

/** One adjustment, for its own page — where the evidence lives. */
export async function getAdjustment(actor: AuthUser, id: number) {
  const row = (
    await db
      .select({
        id: stockAdjustment.id,
        branchId: stockAdjustment.branchId,
        reason: stockAdjustment.reason,
        quantityDelta: stockAdjustment.quantityDelta,
        quantityBefore: stockAdjustment.quantityBefore,
        quantityAfter: stockAdjustment.quantityAfter,
        deviceStatusBefore: stockAdjustment.deviceStatusBefore,
        deviceStatusAfter: stockAdjustment.deviceStatusAfter,
        mainTypeSnapshot: stockAdjustment.mainTypeSnapshot,
        isNewCutSnapshot: stockAdjustment.isNewCutSnapshot,
        notes: stockAdjustment.notes,
        adjustedAt: stockAdjustment.adjustedAt,
        deviceId: stockAdjustment.deviceId,
        identifier: deviceUnit.primaryIdentifier,
        productName: product.name,
        branchName: branch.name,
        adjustedBy: appUser.name,
      })
      .from(stockAdjustment)
      .innerJoin(product, eq(product.id, stockAdjustment.productId))
      .innerJoin(branch, eq(branch.id, stockAdjustment.branchId))
      .leftJoin(deviceUnit, eq(deviceUnit.id, stockAdjustment.deviceId))
      .leftJoin(appUser, eq(appUser.id, stockAdjustment.createdBy))
      .where(
        and(eq(stockAdjustment.id, id), eq(stockAdjustment.businessId, actor.businessId)),
      )
      .limit(1)
  )[0]
  if (!row) throw notFound('Adjustment')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.branchId)) throw notFound('Adjustment')

  return row
}

export type AdjustmentFilters = {
  branchId?: number
  reason?: AdjustmentReason
  from?: string
  to?: string
  page: number
  pageSize: number
}

export async function listAdjustments(actor: AuthUser, filters: AdjustmentFilters) {
  const conditions: SQL[] = [eq(stockAdjustment.businessId, actor.businessId)]

  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(sql`${stockAdjustment.branchId} in ${scope.length ? scope : [-1]}`)
  } else if (filters.branchId) {
    conditions.push(eq(stockAdjustment.branchId, filters.branchId))
  }
  if (filters.reason) conditions.push(eq(stockAdjustment.reason, filters.reason))
  if (filters.from) conditions.push(gte(stockAdjustment.adjustedAt, new Date(filters.from)))
  if (filters.to) {
    conditions.push(lte(stockAdjustment.adjustedAt, new Date(`${filters.to}T23:59:59.999Z`)))
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: stockAdjustment.id,
        reason: stockAdjustment.reason,
        quantityDelta: stockAdjustment.quantityDelta,
        quantityBefore: stockAdjustment.quantityBefore,
        quantityAfter: stockAdjustment.quantityAfter,
        deviceStatusBefore: stockAdjustment.deviceStatusBefore,
        deviceStatusAfter: stockAdjustment.deviceStatusAfter,
        mainTypeSnapshot: stockAdjustment.mainTypeSnapshot,
        isNewCutSnapshot: stockAdjustment.isNewCutSnapshot,
        notes: stockAdjustment.notes,
        adjustedAt: stockAdjustment.adjustedAt,
        productName: product.name,
        identifier: deviceUnit.primaryIdentifier,
        deviceId: stockAdjustment.deviceId,
        branchName: branch.name,
        adjustedBy: appUser.name,
      })
      .from(stockAdjustment)
      .innerJoin(product, eq(product.id, stockAdjustment.productId))
      .innerJoin(branch, eq(branch.id, stockAdjustment.branchId))
      .leftJoin(deviceUnit, eq(deviceUnit.id, stockAdjustment.deviceId))
      .leftJoin(appUser, eq(appUser.id, stockAdjustment.createdBy))
      .where(where)
      .orderBy(desc(stockAdjustment.adjustedAt), desc(stockAdjustment.id))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ n: sql<string>`count(*)` }).from(stockAdjustment).where(where),
  ])

  return { rows, total: Number(counted[0]?.n ?? 0), page: filters.page, pageSize: filters.pageSize }
}

/** Accessories a branch actually holds, for the adjustment picker. */
export async function adjustableStock(actor: AuthUser, branchId: number, search?: string) {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(branchId)) throw notFound('Branch')

  const term = search?.trim()
  const like = term ? `%${term}%` : null

  return db
    .select({
      productId: product.id,
      productName: product.name,
      quantity: branchStock.quantity,
    })
    .from(branchStock)
    .innerJoin(product, eq(product.id, branchStock.productId))
    .where(
      and(
        eq(branchStock.branchId, branchId),
        eq(product.businessId, actor.businessId),
        eq(product.isSerialised, false),
        ...(like ? [sql`${product.name} ilike ${like}`] : []),
      ),
    )
    .orderBy(asc(product.name))
    .limit(25)
}
