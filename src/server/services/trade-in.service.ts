import { and, desc, eq } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import { branch, customer, deviceUnit, product, sale, tradeIn } from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'
import { createDevice } from './device.service'
import type { MainType } from '@/server/db/schema'

/**
 * Taking an old phone in against a new sale (PRD FR-9.1 – FR-9.3).
 *
 * The handset becomes a normal device unit in the receiving branch, with its
 * own event chain starting at PURCHASED - from that moment it is ordinary
 * stock and every other rule in the system applies to it. This table records
 * the deal itself: what it was valued at, what was agreed, and which sale it
 * was set against.
 */

export type TradeInInput = {
  /** The product the old handset is, so it lands in the right catalogue row. */
  productId: number
  identifiers: string[]
  branchId: number
  /** FR-9.3: the classification the old handset takes in stock. */
  mainType: MainType
  isNewCut?: boolean
  newCutNotes?: string
  variant?: string
  storage?: string
  colour?: string
  batteryHealthPercent?: number
  conditionNotes?: string

  estimatedValuePaise?: bigint
  agreedValuePaise: bigint
  customerId?: number | null
  /** Set when the trade-in is applied to a bill; null while being quoted. */
  saleId?: number | null
}

/**
 * Accept a trade-in, creating the device and the record of the deal.
 *
 * Runs on the caller's transaction when given one, so a bill that takes a
 * trade-in either records both the sale and the trade-in or neither.
 */
export async function acceptTradeIn(
  actor: AuthUser,
  ctx: AuditContext,
  input: TradeInInput,
  tx?: DbOrTx,
): Promise<{ id: number; deviceId: number }> {
  if (input.agreedValuePaise < 0n) {
    throw new AppError('A trade-in value cannot be negative.', 422, 'BAD_VALUE')
  }

  const run = async (t: DbOrTx) => {
    /*
     * FR-9.3. The handset enters stock with the classification it was given,
     * including GLOBAL/NEW CUT, and its own device_event chain begins. The
     * agreed value is its purchase price - that is what the shop paid for it.
     */
    const device = await createDevice(
      actor,
      ctx,
      {
        productId: input.productId,
        identifiers: input.identifiers,
        branchId: input.branchId,
        mainType: input.mainType,
        isNewCut: input.isNewCut,
        newCutNotes: input.newCutNotes,
        variant: input.variant,
        storage: input.storage,
        colour: input.colour,
        batteryHealthPercent: input.batteryHealthPercent,
        purchasePricePaise: input.agreedValuePaise,
        notes: input.conditionNotes,
        // A traded-in handset is second-hand stock the shop sells itself,
        // never something the other billing system handles.
        salesChannel: 'ECITY',
      },
      t,
    )

    const created = (
      await t
        .insert(tradeIn)
        .values({
          businessId: actor.businessId,
          saleId: input.saleId ?? null,
          deviceId: device.id,
          customerId: input.customerId ?? null,
          branchId: input.branchId,
          estimatedValuePaise: input.estimatedValuePaise ?? null,
          agreedValuePaise: input.agreedValuePaise,
          conditionNotes: input.conditionNotes?.trim() || null,
          createdBy: actor.id,
        })
        .returning()
    )[0]!

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'trade_in',
        entityId: created.id,
        summary: `Took ${device.primaryIdentifier} in trade for ${Number(input.agreedValuePaise) / 100}`,
      },
      t,
    )

    return { id: created.id, deviceId: device.id }
  }

  return tx ? run(tx) : db.transaction(run)
}

/** Attach an already-accepted trade-in to the bill it was set against. */
export async function linkTradeInToSale(
  actor: AuthUser,
  tradeInId: number,
  saleId: number,
  tx: DbOrTx = db,
): Promise<void> {
  const updated = await tx
    .update(tradeIn)
    .set({ saleId })
    .where(and(eq(tradeIn.id, tradeInId), eq(tradeIn.businessId, actor.businessId)))
    .returning({ id: tradeIn.id })
  if (updated.length === 0) throw notFound('Trade-in')
}

/** Everything taken in trade, newest first. */
export async function listTradeIns(actor: AuthUser, saleId?: number) {
  const conditions = [eq(tradeIn.businessId, actor.businessId)]
  if (saleId) conditions.push(eq(tradeIn.saleId, saleId))

  return db
    .select({
      id: tradeIn.id,
      agreedValuePaise: tradeIn.agreedValuePaise,
      estimatedValuePaise: tradeIn.estimatedValuePaise,
      conditionNotes: tradeIn.conditionNotes,
      acceptedAt: tradeIn.acceptedAt,
      deviceId: tradeIn.deviceId,
      identifier: deviceUnit.primaryIdentifier,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      productName: product.name,
      customerName: customer.name,
      branchName: branch.name,
      saleId: tradeIn.saleId,
      invoiceNumber: sale.invoiceNumber,
    })
    .from(tradeIn)
    .leftJoin(deviceUnit, eq(deviceUnit.id, tradeIn.deviceId))
    .leftJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(customer, eq(customer.id, tradeIn.customerId))
    .leftJoin(branch, eq(branch.id, tradeIn.branchId))
    .leftJoin(sale, eq(sale.id, tradeIn.saleId))
    .where(and(...conditions))
    .orderBy(desc(tradeIn.acceptedAt), desc(tradeIn.id))
    .limit(200)
}
