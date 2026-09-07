import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createDevice, getDevice } from '@/server/services/device.service'
import { getStock, increaseStock } from '@/server/services/stock.service'
import { createSale } from '@/server/services/sale.service'
import {
  approveTransfer,
  canTransition,
  cancelTransfer,
  dispatchTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  requestTransfer,
  sendableStock,
} from '@/server/services/transfer.service'
import {
  createAdjustment,
  getAdjustment,
  listAdjustments,
} from '@/server/services/adjustment.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M8 branch transfers and stock adjustments (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let actor: AuthUser
  /** Scoped to the sending branch only — cannot sign for a delivery at B. */
  let senderOnly: AuthUser
  /** Scoped to the receiving branch only — cannot approve stock out of A. */
  let receiverOnly: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(36_500_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))

  async function stockPhone(n: number, branchId = branchA) {
    const { id } = await createDevice(actor, ctx, {
      productId: phoneProductId,
      identifiers: [imei(n)],
      mainType: 'GLOBAL',
      isNewCut: true,
      sellingPricePaise: rs(20000),
      branchId,
    })
    return id
  }

  /** Request → approve → dispatch, leaving one handset in transit. */
  async function sendPhone(n: number) {
    const deviceId = await stockPhone(n)
    const transfer = await requestTransfer(actor, ctx, {
      fromBranchId: branchA,
      toBranchId: branchB,
      lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
    })
    await approveTransfer(actor, ctx, transfer.id)
    await dispatchTransfer(actor, ctx, transfer.id)
    return { deviceId, transferId: transfer.id }
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M8 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M8A${stamp}`.slice(0, 12), name: 'M8 Branch A' },
          { businessId, code: `M8B${stamp}`.slice(0, 12), name: 'M8 Branch B' },
        ])
        .returning()
    ).map((b) => b.id) as [number, number]

    cashMethodId = (
      await db
        .insert(schema.paymentMethod)
        .values({ businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M8 Tester',
      email: 'm8@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    senderOnly = { ...actor, branchIds: [branchA], canViewAllBranches: false }
    receiverOnly = { ...actor, branchIds: [branchB], canViewAllBranches: false }
    ctx = { actor: null, businessId, branchId: branchA }

    const mobiles = await createCategory(actor, ctx, {
      name: 'M8 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M8 Cables', isSerialised: false })
    phoneProductId = (await createProduct(actor, ctx, { name: 'M8 Phone', categoryId: mobiles.id }))
      .id
    cableProductId = (await createProduct(actor, ctx, { name: 'M8 Cable', categoryId: cables.id }))
      .id

    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId: branchA, quantity: 100, movement: 'PURCHASE' },
    )
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      const ids = devices.map((d) => d.id)
      await clearMoney(businessId)
      await db.execute(`delete from transfer_item where transfer_id in
        (select id from stock_transfer where business_id = ${businessId})`)
      await db.execute(`delete from stock_transfer where business_id = ${businessId}`)
      await db.execute(`delete from stock_adjustment where business_id = ${businessId}`)
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db
          .delete(schema.deviceIdentifier)
          .where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db
        .delete(schema.documentSequence)
        .where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('the state machine (FR-3.6)', () => {
    it('allows only the steps the lifecycle defines', () => {
      expect(canTransition('REQUESTED', 'APPROVED')).toBe(true)
      expect(canTransition('APPROVED', 'IN_TRANSIT')).toBe(true)
      expect(canTransition('IN_TRANSIT', 'RECEIVED')).toBe(true)
      // Cancelled is available right up to receipt.
      for (const from of ['REQUESTED', 'APPROVED', 'IN_TRANSIT'] as const) {
        expect(canTransition(from, 'CANCELLED')).toBe(true)
      }
      // ...and nothing comes back from the two terminal states.
      expect(canTransition('RECEIVED', 'CANCELLED')).toBe(false)
      expect(canTransition('RECEIVED', 'IN_TRANSIT')).toBe(false)
      expect(canTransition('CANCELLED', 'APPROVED')).toBe(false)
      // No skipping steps: stock cannot leave before anyone approved it.
      expect(canTransition('REQUESTED', 'IN_TRANSIT')).toBe(false)
      expect(canTransition('REQUESTED', 'RECEIVED')).toBe(false)
      expect(canTransition('APPROVED', 'RECEIVED')).toBe(false)
    })

    it('refuses an illegal step on a real transfer', async () => {
      const deviceId = await stockPhone(1)
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
      })
      // Dispatching something nobody approved.
      await expect(dispatchTransfer(actor, ctx, t.id)).rejects.toThrow(/cannot go from REQUESTED/i)
      // Receiving something that never left.
      await expect(receiveTransfer(actor, ctx, t.id, [])).rejects.toThrow(/cannot go from/i)
    })

    it('refuses a transfer to the same branch', async () => {
      await expect(
        requestTransfer(actor, ctx, {
          fromBranchId: branchA,
          toBranchId: branchA,
          lines: [{ productId: cableProductId, quantity: 1 }],
        }),
      ).rejects.toThrow(/different branches/i)
    })

    it('refuses a device that is not at the sending branch', async () => {
      const elsewhere = await stockPhone(2, branchB)
      await expect(
        requestTransfer(actor, ctx, {
          fromBranchId: branchA,
          toBranchId: branchB,
          lines: [{ productId: phoneProductId, deviceId: elsewhere, quantity: 1 }],
        }),
      ).rejects.toThrow(/not at the sending branch/i)
    })

    it('refuses the same handset on two open transfers', async () => {
      const deviceId = await stockPhone(3)
      await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
      })
      await expect(
        requestTransfer(actor, ctx, {
          fromBranchId: branchA,
          toBranchId: branchB,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
        }),
      ).rejects.toThrow(/already on another transfer/i)
    })
  })

  describe('who may do which step', () => {
    /*
     * A receipt is someone at the destination confirming the goods turned up.
     * If the sending branch could sign for them the confirmation would be
     * worth nothing — the person who packed the box would be attesting it
     * arrived.
     */
    it('only the receiving branch can sign for a delivery', async () => {
      const { transferId } = await sendPhone(30)
      const detail = await getTransfer(actor, transferId)

      await expect(
        receiveTransfer(senderOnly, ctx, transferId, [
          { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
        ]),
      ).rejects.toThrow(/receiving branch/i)

      // The branch it actually went to can.
      await receiveTransfer(receiverOnly, ctx, transferId, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
      ])
      expect((await getTransfer(actor, transferId)).transfer.status).toBe('RECEIVED')
    })

    it('only the sending branch can approve and dispatch', async () => {
      const deviceId = await stockPhone(31)
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
      })
      // Sending stock out of a branch is that branch's decision.
      await expect(approveTransfer(receiverOnly, ctx, t.id)).rejects.toThrow(/sending branch/i)
      await approveTransfer(senderOnly, ctx, t.id)
      await expect(dispatchTransfer(receiverOnly, ctx, t.id)).rejects.toThrow(/sending branch/i)
      await dispatchTransfer(senderOnly, ctx, t.id)
      expect((await getTransfer(actor, t.id)).transfer.status).toBe('IN_TRANSIT')
    })

    it('an owner who sees every branch is not blocked by either guard', async () => {
      const { transferId } = await sendPhone(32)
      const detail = await getTransfer(actor, transferId)
      // `actor` has canViewAllBranches — there is nobody else to check them.
      await receiveTransfer(actor, ctx, transferId, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
      ])
      expect((await getTransfer(actor, transferId)).transfer.status).toBe('RECEIVED')
    })
  })

  describe('in transit belongs to neither branch', () => {
    it('a dispatched handset cannot be sold at either end', async () => {
      const { deviceId } = await sendPhone(4)

      const inTransit = await getDevice(actor, deviceId)
      expect(inTransit.device.status).toBe('IN_TRANSIT')

      // Not sellable at the branch it left...
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
        }),
      ).rejects.toThrow(/IN_TRANSIT/)

      /*
       * ...nor at the one it is going to, until it actually arrives. A
       * different guard catches this one: dispatch left the device's branch as
       * the sender, so branch B refuses it as not being here at all. Both
       * refusals are correct and both are worth pinning down.
       */
      await expect(
        createSale(actor, ctx, {
          branchId: branchB,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
        }),
      ).rejects.toThrow(/not at this branch/i)
    })

    it('accessory stock leaves the source on dispatch and arrives on receipt', async () => {
      const before = (await getStock(cableProductId, branchA))?.quantity ?? 0
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: cableProductId, quantity: 10 }],
      })
      // A request alone moves nothing.
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before)

      await approveTransfer(actor, ctx, t.id)
      await dispatchTransfer(actor, ctx, t.id)

      // Gone from A, and not yet at B - in transit is nowhere.
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before - 10)
      const atBBefore = (await getStock(cableProductId, branchB))?.quantity ?? 0

      const detail = await getTransfer(actor, t.id)
      await receiveTransfer(actor, ctx, t.id, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 10 },
      ])
      expect((await getStock(cableProductId, branchB))?.quantity ?? 0).toBe(atBBefore + 10)
    })
  })

  describe('receiving (FR-3.7)', () => {
    it('moves the exact IMEI and leaves a history naming both branches', async () => {
      const { deviceId, transferId } = await sendPhone(5)
      const detail = await getTransfer(actor, transferId)
      await receiveTransfer(actor, ctx, transferId, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
      ])

      const arrived = await getDevice(actor, deviceId)
      expect(arrived.device.status).toBe('IN_STOCK')
      expect(arrived.device.currentBranchId).toBe(branchB)
      // FR-8.4's sibling: classification survives the journey untouched.
      expect(arrived.device.mainType).toBe('GLOBAL')
      expect(arrived.device.isNewCut).toBe(true)

      const types = arrived.events.map((e) => e.eventType)
      expect(types).toContain('TRANSFERRED_OUT')
      expect(types).toContain('TRANSFERRED_IN')

      /*
       * FR-3.7 wants BOTH branch ids on the event, not one of them with the
       * other buried in the payload. M9's IMEI timeline reads these columns,
       * so "moved from A to B" has to be answerable without parsing JSON.
       */
      const out = arrived.events.find((e) => e.eventType === 'TRANSFERRED_OUT')!
      expect(out.fromBranchId).toBe(branchA)
      expect(out.toBranchId).toBe(branchB)

      const into = arrived.events.find((e) => e.eventType === 'TRANSFERRED_IN')!
      expect(into.fromBranchId).toBe(branchA)
      expect(into.toBranchId).toBe(branchB)
    })

    it('records a shortfall rather than losing a handset quietly', async () => {
      const { deviceId, transferId } = await sendPhone(6)
      const detail = await getTransfer(actor, transferId)

      // The box arrived without it.
      const { hasDiscrepancy } = await receiveTransfer(
        actor,
        ctx,
        transferId,
        [{ transferItemId: detail.items[0]!.id, receivedQuantity: 0 }],
        'Box was opened in transit',
      )
      expect(hasDiscrepancy).toBe(true)

      /*
       * It left one branch and reached no other, so it is LOST - not left
       * IN_TRANSIT on a closed transfer, which would strand it in a state
       * nothing could move it out of.
       */
      const missing = await getDevice(actor, deviceId)
      expect(missing.device.status).toBe('LOST')
      // It left the sender and reached nobody, so there is no destination.
      const lost = missing.events.find((e) => e.eventType === 'LOST')!
      expect(lost.fromBranchId).toBe(branchA)
      expect(lost.toBranchId).toBeNull()

      const closed = await getTransfer(actor, transferId)
      expect(closed.transfer.hasDiscrepancy).toBe(true)
      expect(closed.transfer.discrepancyNotes).toBe('Box was opened in transit')
    })

    it('a partly received accessory line is short by the difference', async () => {
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: cableProductId, quantity: 5 }],
      })
      await approveTransfer(actor, ctx, t.id)
      await dispatchTransfer(actor, ctx, t.id)
      const atB = (await getStock(cableProductId, branchB))?.quantity ?? 0

      const detail = await getTransfer(actor, t.id)
      const { hasDiscrepancy } = await receiveTransfer(actor, ctx, t.id, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 3 },
      ])
      expect(hasDiscrepancy).toBe(true)
      // Only what turned up is added.
      expect((await getStock(cableProductId, branchB))?.quantity ?? 0).toBe(atB + 3)
    })

    it('records something that arrived but was not on the transfer', async () => {
      const { transferId } = await sendPhone(20)
      const detail = await getTransfer(actor, transferId)

      const stray = imei(99)
      const { hasDiscrepancy, unexpected } = await receiveTransfer(
        actor,
        ctx,
        transferId,
        [{ transferItemId: detail.items[0]!.id, receivedQuantity: 1 }],
        undefined,
        [stray],
      )

      /*
       * Everything on the paperwork arrived, so nothing is short - but there
       * was an extra handset in the box. That is still a discrepancy: the
       * system thinks it is somewhere else.
       */
      expect(hasDiscrepancy).toBe(true)
      expect(unexpected).toEqual([stray])

      const closed = await getTransfer(actor, transferId)
      expect(closed.transfer.discrepancyNotes).toContain(stray)
      // It is recorded, NOT moved - that would invent a transfer nobody
      // authorised.
      const moved = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.primaryIdentifier, stray))
      expect(moved).toHaveLength(0)
    })

    it('refuses to receive more than was sent', async () => {
      const { transferId } = await sendPhone(7)
      const detail = await getTransfer(actor, transferId)
      await expect(
        receiveTransfer(actor, ctx, transferId, [
          { transferItemId: detail.items[0]!.id, receivedQuantity: 2 },
        ]),
      ).rejects.toThrow(/between zero and what was sent/i)
    })
  })

  describe('cancelling', () => {
    it('an in-transit transfer puts the handset back where it came from', async () => {
      const { deviceId, transferId } = await sendPhone(8)
      await cancelTransfer(actor, ctx, transferId, 'Van broke down')

      const back = await getDevice(actor, deviceId)
      expect(back.device.status).toBe('IN_STOCK')
      expect(back.device.currentBranchId).toBe(branchA)

      // It never reached the destination, so the event must not claim a
      // journey back from a branch it was never at.
      const last = back.events.find((e) => e.eventType === 'TRANSFERRED_IN')!
      expect(last.fromBranchId).toBeNull()
      expect(last.toBranchId).toBe(branchA)
    })

    it('an in-transit transfer puts accessory stock back too', async () => {
      const before = (await getStock(cableProductId, branchA))?.quantity ?? 0
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: cableProductId, quantity: 7 }],
      })
      await approveTransfer(actor, ctx, t.id)
      await dispatchTransfer(actor, ctx, t.id)
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before - 7)

      await cancelTransfer(actor, ctx, t.id, 'Not needed after all')
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before)
    })

    it('cancelling before dispatch moves no stock at all', async () => {
      const before = (await getStock(cableProductId, branchA))?.quantity ?? 0
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: cableProductId, quantity: 4 }],
      })
      await cancelTransfer(actor, ctx, t.id, 'Asked by mistake')
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before)
    })

    it('cannot be cancelled once received', async () => {
      const { transferId } = await sendPhone(9)
      const detail = await getTransfer(actor, transferId)
      await receiveTransfer(actor, ctx, transferId, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
      ])
      await expect(cancelTransfer(actor, ctx, transferId, 'Changed my mind')).rejects.toThrow(
        /cannot go from RECEIVED/i,
      )
    })

    it('needs a reason', async () => {
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: cableProductId, quantity: 1 }],
      })
      await expect(cancelTransfer(actor, ctx, t.id, '  ')).rejects.toThrow(/why/i)
    })
  })

  describe('stock adjustments (FR-28.1 – FR-28.3)', () => {
    it('a miscount changes the count and shows in the movement ledger', async () => {
      const before = (await getStock(cableProductId, branchA))?.quantity ?? 0
      const { id } = await createAdjustment(actor, ctx, {
        branchId: branchA,
        productId: cableProductId,
        reason: 'MISCOUNT',
        quantityDelta: -3,
        notes: 'Counted 3 fewer on the shelf',
      })
      expect((await getStock(cableProductId, branchA))?.quantity ?? 0).toBe(before - 3)

      const listed = await listAdjustments(actor, { page: 1, pageSize: 50 })
      const found = listed.rows.find((r) => r.id === id)!
      expect(found.reason).toBe('MISCOUNT')
      expect(found.quantityBefore).toBe(before)
      expect(found.quantityAfter).toBe(before - 3)

      // FR-21's movement report reads the stock ledger, so it must be there.
      const ledger = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.refId, id))
      expect(ledger.some((l) => l.movement === 'ADJUSTMENT')).toBe(true)

      // ...and the acceptance criterion names the audit log too.
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.entityType, 'stock_adjustment'),
            eq(schema.auditLog.entityId, String(id)),
          ),
        )
      expect(audit).toHaveLength(1)
      expect(audit[0]!.summary).toContain('MISCOUNT')
    })

    it('a damaged handset leaves sellable stock and keeps its classification', async () => {
      const deviceId = await stockPhone(10)
      const { id } = await createAdjustment(actor, ctx, {
        branchId: branchA,
        productId: phoneProductId,
        deviceId,
        reason: 'DAMAGE',
        notes: 'Screen cracked in the drawer',
      })

      const after = await getDevice(actor, deviceId)
      expect(after.device.status).toBe('DAMAGED')
      // FR-28.2 snapshots the classification as it was at the time.
      const row = (await listAdjustments(actor, { page: 1, pageSize: 50 })).rows.find(
        (r) => r.id === id,
      )!
      expect(row.mainTypeSnapshot).toBe('GLOBAL')
      expect(row.isNewCutSnapshot).toBe(true)
      expect(row.deviceStatusBefore).toBe('IN_STOCK')
      expect(row.deviceStatusAfter).toBe('DAMAGED')
    })

    it('can be opened on its own, which is where the evidence lives', async () => {
      const deviceId = await stockPhone(21)
      const { id } = await createAdjustment(actor, ctx, {
        branchId: branchA,
        productId: phoneProductId,
        deviceId,
        reason: 'DAMAGE',
        notes: 'Dropped on the counter',
      })
      const one = await getAdjustment(actor, id)
      expect(one.reason).toBe('DAMAGE')
      expect(one.deviceStatusAfter).toBe('DAMAGED')
      expect(one.notes).toBe('Dropped on the counter')
      expect(one.mainTypeSnapshot).toBe('GLOBAL')
    })

    it('refuses a miscount on a handset — that is a device correction, not a count', async () => {
      const deviceId = await stockPhone(11)
      await expect(
        createAdjustment(actor, ctx, {
          branchId: branchA,
          productId: phoneProductId,
          deviceId,
          reason: 'MISCOUNT',
        }),
      ).rejects.toThrow(/one handset/i)
    })

    it('refuses a count adjustment on a serialised product', async () => {
      await expect(
        createAdjustment(actor, ctx, {
          branchId: branchA,
          productId: phoneProductId,
          reason: 'MISCOUNT',
          quantityDelta: -1,
        }),
      ).rejects.toThrow(/one handset at a time/i)
    })

    it('refuses an adjustment of nothing', async () => {
      await expect(
        createAdjustment(actor, ctx, {
          branchId: branchA,
          productId: cableProductId,
          reason: 'MISCOUNT',
          quantityDelta: 0,
        }),
      ).rejects.toThrow(/nothing changes nothing/i)
    })
  })

  describe('reading', () => {
    it('lists transfers newest first and shows both ends', async () => {
      const { rows } = await listTransfers(actor, { page: 1, pageSize: 50 })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.fromBranchName).toBe('M8 Branch A')
      expect(rows[0]!.toBranchName).toBe('M8 Branch B')
      // Gapless, per branch series, like every other document in the system.
      expect(rows[0]!.transferNumber).toMatch(/TRF-\d+$/)
    })

    it('filters by status, which is what the approval queue reads', async () => {
      const deviceId = await stockPhone(12)
      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
      })
      const queue = await listTransfers(actor, { status: 'REQUESTED', page: 1, pageSize: 50 })
      expect(queue.rows.some((r) => r.id === t.id)).toBe(true)
      expect(queue.rows.every((r) => r.status === 'REQUESTED')).toBe(true)
    })

    it('only offers stock the sending branch actually has', async () => {
      const { devices, accessories } = await sendableStock(actor, branchA)
      // Nothing in transit, sold, damaged or at the other branch.
      expect(devices.every((d) => d.identifier !== null)).toBe(true)
      expect(accessories.every((a) => a.quantity > 0)).toBe(true)
    })
  })
})
