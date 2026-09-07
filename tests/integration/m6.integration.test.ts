import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice, getDevice, updateDevice } from '@/server/services/device.service'
import { increaseStock, getStock } from '@/server/services/stock.service'
import { createSale, getSale } from '@/server/services/sale.service'
import { customerBalance } from '@/server/services/customer-ledger.service'
import {
  createReturn,
  getReturn,
  inspectDevice,
  inspectionQueue,
  returnableLines,
} from '@/server/services/return.service'
import { acceptTradeIn, listTradeIns } from '@/server/services/trade-in.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M6 returns, exchange and trade-in (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let customerId: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(35_600_000_000_000 + (stamp % 1_000_000) * 100 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))

  /** Sell one handset and hand back the ids the return needs. */
  async function sellPhone(n: number, opts: { mainType?: 'USED' | 'GLOBAL'; isNewCut?: boolean; paid?: boolean } = {}) {
    const device = await createDevice(actor, ctx, {
      productId: phoneProductId,
      identifiers: [imei(n)],
      mainType: opts.mainType ?? 'USED',
      isNewCut: opts.isNewCut,
      branchId: branchA,
    })
    const sold = await createSale(actor, ctx, {
      branchId: branchA,
      customerId,
      lines: [
        { productId: phoneProductId, deviceId: device.id, quantity: 1, unitPricePaise: rs(20000) },
      ],
      payments: opts.paid === false ? [] : [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
    })
    const detail = await getSale(actor, sold.id)
    return { deviceId: device.id, saleId: sold.id, saleItemId: detail.items[0]!.id }
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M6 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M6A${stamp}`.slice(0, 12), name: 'M6 Branch A' },
          { businessId, code: `M6B${stamp}`.slice(0, 12), name: 'M6 Branch B' },
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
      name: 'M6 Tester',
      email: 'm6@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    customerId = (await createParty(actor, ctx, 'customer', { name: `Returner ${stamp}` })).id
    const mobiles = await createCategory(actor, ctx, {
      name: 'M6 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M6 Cables', isSerialised: false })
    phoneProductId = (await createProduct(actor, ctx, { name: 'M6 Phone', categoryId: mobiles.id })).id
    cableProductId = (await createProduct(actor, ctx, { name: 'M6 Cable', categoryId: cables.id })).id
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId: branchA, quantity: 1000, movement: 'PURCHASE' },
    )
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      await db.execute(`delete from refund where business_id = ${businessId}`)
      await db.execute(`delete from return_item where return_id in
        (select id from sales_return where business_id = ${businessId})`)
      await db.execute(`delete from trade_in where business_id = ${businessId}`)
      await db.execute(`delete from sales_return where business_id = ${businessId}`)
      await clearMoney(businessId)
      await clearCustomerCredit(businessId)
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      if (devices.length) {
        const ids = devices.map((d) => d.id).join(',')
        await db.execute(`delete from device_event where device_id in (${ids})`)
        await db.execute(`delete from device_identifier where device_id in (${ids})`)
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db.delete(schema.documentSequence).where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('a returned handset is never immediately sellable (FR-8.2)', () => {
    it('goes to RETURNED, not back into stock', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(1)
      await createReturn(actor, ctx, {
        saleId,
        branchId: branchA,
        lines: [{ saleItemId, quantity: 1 }],
        reason: 'Changed their mind',
      })
      expect((await getDevice(actor, deviceId)).device.status).toBe('RETURNED')
    })

    it('appears in the inspection queue until someone grades it', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(2)
      await createReturn(actor, ctx, { saleId, branchId: branchA, lines: [{ saleItemId, quantity: 1 }] })

      expect(((await inspectionQueue(actor)).rows).some((d) => d.id === deviceId)).toBe(true)
      await inspectDevice(actor, ctx, { deviceId, grade: 'AVAILABLE' })
      expect(((await inspectionQueue(actor)).rows).some((d) => d.id === deviceId)).toBe(false)
    })

    it('cannot be sold again before it is graded', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(3)
      await createReturn(actor, ctx, { saleId, branchId: branchA, lines: [{ saleItemId, quantity: 1 }] })

      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          customerId,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(18000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(18000) }],
        }),
      ).rejects.toThrow(/no longer available/i)
    })

    it('becomes sellable once graded AVAILABLE', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(4)
      await createReturn(actor, ctx, { saleId, branchId: branchA, lines: [{ saleItemId, quantity: 1 }] })
      await inspectDevice(actor, ctx, { deviceId, grade: 'AVAILABLE' })

      expect((await getDevice(actor, deviceId)).device.status).toBe('IN_STOCK')
      const resold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(18000) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(18000) }],
      })
      expect(resold.id).toBeGreaterThan(0)
    })

    it('a damaged grade holds it out of stock', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(5)
      await createReturn(actor, ctx, { saleId, branchId: branchA, lines: [{ saleItemId, quantity: 1 }] })
      await inspectDevice(actor, ctx, { deviceId, grade: 'DAMAGED', notes: 'Cracked screen' })

      const d = await getDevice(actor, deviceId)
      expect(d.device.status).toBe('DAMAGED')
      expect(d.device.inspectionGrade).toBe('DAMAGED')
    })

    it('refuses to inspect something that is not awaiting inspection', async () => {
      const { deviceId } = await sellPhone(6)
      await expect(
        inspectDevice(actor, ctx, { deviceId, grade: 'AVAILABLE' }),
      ).rejects.toThrow(/not awaiting inspection/i)
    })
  })

  describe('classification survives the whole path (FR-8.4)', () => {
    it('a GLOBAL + NEW CUT handset still reads GLOBAL + NEW CUT after return and grading', async () => {
      const { deviceId, saleId, saleItemId } = await sellPhone(10, {
        mainType: 'GLOBAL',
        isNewCut: true,
      })

      const before = (await getDevice(actor, deviceId)).device
      expect(before.mainType).toBe('GLOBAL')
      expect(before.isNewCut).toBe(true)

      await createReturn(actor, ctx, { saleId, branchId: branchA, lines: [{ saleItemId, quantity: 1 }] })
      const returned = (await getDevice(actor, deviceId)).device
      expect(returned.mainType).toBe('GLOBAL')
      expect(returned.isNewCut).toBe(true)

      // Graded USED - a condition, not a reclassification.
      await inspectDevice(actor, ctx, { deviceId, grade: 'USED' })
      const graded = (await getDevice(actor, deviceId)).device
      expect(graded.mainType).toBe('GLOBAL')
      expect(graded.isNewCut).toBe(true)
      expect(graded.inspectionGrade).toBe('USED')
      expect(graded.status).toBe('IN_STOCK')
    })
  })

  describe('partial returns and accessories', () => {
    it('puts a counted accessory straight back on the shelf', async () => {
      const before = (await getStock(cableProductId, branchA))!.quantity
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 5, unitPricePaise: rs(200) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(1000) }],
      })
      expect((await getStock(cableProductId, branchA))!.quantity).toBe(before - 5)

      const detail = await getSale(actor, sold.id)
      await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 2 }],
      })
      // No unit to inspect, so it is sellable again immediately.
      expect((await getStock(cableProductId, branchA))!.quantity).toBe(before - 3)
    })

    it('refunds a part quantity pro rata', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 5, unitPricePaise: rs(200) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(1000) }],
      })
      const detail = await getSale(actor, sold.id)
      const { id } = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 2 }],
      })
      // Two of five, so two fifths of the line.
      expect((await getReturn(actor, id)).salesReturn.totalPaise).toBe(rs(400))
    })

    it('refuses to return more than was bought', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 3, unitPricePaise: rs(200) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(600) }],
      })
      const detail = await getSale(actor, sold.id)
      await expect(
        createReturn(actor, ctx, {
          saleId: sold.id,
          branchId: branchA,
          lines: [{ saleItemId: detail.items[0]!.id, quantity: 4 }],
        }),
      ).rejects.toThrow(/only 3 left to return/i)
    })

    it('counts earlier returns, so two partials cannot exceed the whole', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 4, unitPricePaise: rs(200) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(800) }],
      })
      const detail = await getSale(actor, sold.id)
      const saleItemId = detail.items[0]!.id

      await createReturn(actor, ctx, { saleId: sold.id, branchId: branchA, lines: [{ saleItemId, quantity: 3 }] })
      expect((await returnableLines(actor, sold.id)).lines[0]!.remainingQty).toBe(1)

      await expect(
        createReturn(actor, ctx, { saleId: sold.id, branchId: branchA, lines: [{ saleItemId, quantity: 2 }] }),
      ).rejects.toThrow(/only 1 left to return/i)
    })

    it('a whole bill coming back at once is recorded as FULL', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 2, unitPricePaise: rs(150) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(300) }],
      })
      const detail = await getSale(actor, sold.id)
      const { id } = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 2 }],
      })
      expect((await getReturn(actor, id)).salesReturn.returnType).toBe('FULL')
    })
  })

  describe('the money (FR-8.5)', () => {
    it('a refund paid out leaves the account square, not in credit', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Cash ${stamp}` })).id
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(500) }],
      })
      expect(await customerBalance(buyer)).toBe(0n)

      const detail = await getSale(actor, sold.id)
      await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        refund: { method: 'PAYMENT_METHOD', paymentMethodId: cashMethodId },
      })

      /*
       * They paid, returned the goods and got the money back. The account must
       * end where it started. Wiping the debt AND handing over cash is the
       * classic returns bug - the shop pays twice.
       */
      expect(await customerBalance(buyer)).toBe(0n)
    })

    it('returning against an unpaid bill just reduces what they owe', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Credit ${stamp}` })).id
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 2, unitPricePaise: rs(500) }],
        payments: [],
      })
      expect(await customerBalance(buyer)).toBe(rs(1000))

      const detail = await getSale(actor, sold.id)
      await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        refund: { method: 'CUSTOMER_ACCOUNT' },
      })
      // One of two returned, so they owe half. No cash changes hands.
      expect(await customerBalance(buyer)).toBe(rs(500))
    })

    it('a deduction is taken off what is given back', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(1000) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(1000) }],
      })
      const detail = await getSale(actor, sold.id)
      const { id } = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        deductionPaise: rs(100),
        refund: { method: 'PAYMENT_METHOD', paymentMethodId: cashMethodId },
      })
      const r = await getReturn(actor, id)
      expect(r.salesReturn.totalPaise).toBe(rs(1000))
      expect(r.salesReturn.deductionPaise).toBe(rs(100))
      expect(r.salesReturn.refundedPaise).toBe(rs(900))
    })

    it('refuses to credit the account of a walk-in', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(300) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(300) }],
      })
      const detail = await getSale(actor, sold.id)
      await expect(
        createReturn(actor, ctx, {
          saleId: sold.id,
          branchId: branchA,
          lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
          refund: { method: 'CUSTOMER_ACCOUNT' },
        }),
      ).rejects.toThrow(/walk-in has no account/i)
    })

    it('goods can come back to a different branch than they were sold at', async () => {
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(250) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(250) }],
      })
      const detail = await getSale(actor, sold.id)
      const { id } = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchB,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
      })
      // Sold at A, returned at B: the stock lands at B.
      expect((await getReturn(actor, id)).salesReturn.branchId).toBe(branchB)
      expect((await getStock(cableProductId, branchB))!.quantity).toBe(1)
    })
  })

  describe('a refund cannot exceed what the bill was settled by', () => {
    it('pays out nothing on goods bought on credit and never paid for', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Credit ${stamp}` })).id
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [],
      })
      expect(await customerBalance(buyer)).toBe(rs(500))

      const detail = await getSale(actor, sold.id)
      const ret = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        refund: { method: 'PAYMENT_METHOD', paymentMethodId: cashMethodId },
      })

      // They never handed over a rupee, so none goes back...
      const full = await getReturn(actor, ret.id)
      expect(full.refunds.reduce((s, r) => s + r.amountPaise, 0n)).toBe(0n)
      // ...and the debt is cleared by the goods coming back.
      expect(await customerBalance(buyer)).toBe(0n)
    })

    it('gives back what was paid and writes off the rest', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Part ${stamp}` })).id
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 2, unitPricePaise: rs(500) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(400) }],
      })

      const detail = await getSale(actor, sold.id)
      const ret = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 2 }],
        refund: { method: 'PAYMENT_METHOD', paymentMethodId: cashMethodId },
      })

      const full = await getReturn(actor, ret.id)
      expect(full.refunds.reduce((s, r) => s + r.amountPaise, 0n)).toBe(rs(400))
      expect(await customerBalance(buyer)).toBe(0n)
    })

    it('still credits the whole value to the account when no money moves', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Note ${stamp}` })).id
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [],
      })
      const detail = await getSale(actor, sold.id)
      // A credit note is not a payout, so the cap must not touch it.
      const ret = await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        refund: { method: 'CUSTOMER_ACCOUNT' },
      })
      const full = await getReturn(actor, ret.id)
      expect(full.refunds.reduce((s, r) => s + r.amountPaise, 0n)).toBe(rs(500))
      expect(await customerBalance(buyer)).toBe(0n)
    })
  })

  describe('trade-in (FR-9.1 – FR-9.3)', () => {
    it('creates a device in the receiving branch with its classification intact', async () => {
      const { id, deviceId } = await acceptTradeIn(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(20)],
        branchId: branchB,
        mainType: 'GLOBAL',
        isNewCut: true,
        agreedValuePaise: rs(5000),
        estimatedValuePaise: rs(6000),
        conditionNotes: 'Screen scratched',
        customerId,
      })

      const d = (await getDevice(actor, deviceId)).device
      expect(d.mainType).toBe('GLOBAL')
      expect(d.isNewCut).toBe(true)
      expect(d.currentBranchId).toBe(branchB)
      expect(d.status).toBe('IN_STOCK')
      // What the shop paid for it.
      expect(d.purchasePricePaise).toBe(rs(5000))
      // Never the other billing system's to sell.
      expect(d.salesChannel).toBe('ECITY')
      expect(id).toBeGreaterThan(0)
    })

    it('starts its own event chain', async () => {
      const { deviceId } = await acceptTradeIn(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(21)],
        branchId: branchA,
        mainType: 'USED',
        agreedValuePaise: rs(3000),
      })
      const events = (await getDevice(actor, deviceId)).events
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.eventType).toBe('PURCHASED')
    })

    it('links the old device, the new sale and the difference paid', async () => {
      // Its own customer, so the balance assertion below reads this exchange
      // alone rather than everything the shared one has done.
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Swap ${stamp}` })).id
      // The customer trades in an old handset against a new one.
      const newDevice = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(30)],
        mainType: 'USED',
        branchId: branchA,
      })
      const trade = await acceptTradeIn(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(31)],
        branchId: branchA,
        mainType: 'USED',
        agreedValuePaise: rs(8000),
        customerId: buyer,
      })

      // New phone 25,000 less 8,000 traded in = 17,000 to pay.
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [
          { productId: phoneProductId, deviceId: newDevice.id, quantity: 1, unitPricePaise: rs(25000) },
        ],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(17000) }],
        tradeInId: trade.id,
      })

      const linked = (await listTradeIns(actor, sold.id))[0]!
      expect(linked.agreedValuePaise).toBe(rs(8000))
      expect(linked.deviceId).toBe(trade.deviceId)
      expect(linked.saleId).toBe(sold.id)

      /*
       * The bill stays at the full 25,000 and GST is charged on all of it, but
       * nothing is left owing: 17,000 in cash and 8,000 in kind settle it. The
       * bug this guards against is the exchange leaving a receivable the
       * customer already settled with the handset.
       */
      const detail = await getSale(actor, sold.id)
      expect(detail.sale.totalPaise).toBe(rs(25000))
      expect(detail.paidPaise).toBe(rs(25000))
      expect(detail.paymentStatus).toBe('PAID')
      expect(detail.sale.dueDate).toBeNull()
      expect(detail.tradeIns).toHaveLength(1)

      // ...and the customer's account agrees. 25,000 owed, 25,000 cleared.
      expect(await customerBalance(buyer)).toBe(0n)
    })

    it('refuses to put the same trade-in on a second bill', async () => {
      const trade = await acceptTradeIn(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(32)],
        branchId: branchA,
        mainType: 'USED',
        agreedValuePaise: rs(5000),
      })
      const mk = async () => {
        const d = await createDevice(actor, ctx, {
          productId: phoneProductId,
          identifiers: [imei(33 + Math.floor(Math.random() * 100000))],
          mainType: 'USED',
          branchId: branchA,
        })
        return createSale(actor, ctx, {
          branchId: branchA,
          customerId,
          lines: [
            { productId: phoneProductId, deviceId: d.id, quantity: 1, unitPricePaise: rs(5000) },
          ],
          payments: [],
          tradeInId: trade.id,
        })
      }
      await mk()
      // Settling its value twice would hand the shop's money away.
      await expect(mk()).rejects.toThrow(/already on another bill/i)
    })

    it('lets a walk-in exchange settle entirely with the handset', async () => {
      const newDevice = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(34)],
        mainType: 'USED',
        branchId: branchA,
      })
      const trade = await acceptTradeIn(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(35)],
        branchId: branchA,
        mainType: 'USED',
        agreedValuePaise: rs(9000),
      })
      // No customer, no cash - but nothing is owed either, so this is not
      // credit and must be allowed.
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        lines: [
          { productId: phoneProductId, deviceId: newDevice.id, quantity: 1, unitPricePaise: rs(9000) },
        ],
        payments: [],
        tradeInId: trade.id,
      })
      const detail = await getSale(actor, sold.id)
      expect(detail.paymentStatus).toBe('PAID')
    })
  })

  describe('correcting a device (carried in from M5)', () => {
    it('fixes a wrong main type and records it in the history', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(40)],
        mainType: 'NEW',
        branchId: branchA,
      })
      await updateDevice(actor, ctx, id, { mainType: 'USED' })

      const d = await getDevice(actor, id)
      expect(d.device.mainType).toBe('USED')
      // The correction is part of the timeline, not a silent rewrite.
      expect(d.events.some((e) => e.eventType === 'RECLASSIFIED')).toBe(true)
    })

    it('can put a NEW handset on sale here, which is the case that started this', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(41)],
        mainType: 'NEW',
        branchId: branchA,
      })
      expect((await getDevice(actor, id)).device.salesChannel).toBe('EXTERNAL')

      await updateDevice(actor, ctx, id, { salesChannel: 'ECITY' })
      expect((await getDevice(actor, id)).device.salesChannel).toBe('ECITY')
    })

    it('refuses NEW CUT on anything that is not GLOBAL', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(42)],
        mainType: 'USED',
        branchId: branchA,
      })
      await expect(updateDevice(actor, ctx, id, { isNewCut: true })).rejects.toThrow()
    })

    it('refuses to edit a device that has been sold', async () => {
      const { deviceId } = await sellPhone(43)
      await expect(
        updateDevice(actor, ctx, deviceId, { colour: 'Blue' }),
      ).rejects.toThrow(/can no longer be edited/i)
    })

    it('does nothing when nothing actually changed', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(44)],
        mainType: 'USED',
        colour: 'Black',
        branchId: branchA,
      })
      const before = (await getDevice(actor, id)).events.length
      await updateDevice(actor, ctx, id, { colour: 'Black', mainType: 'USED' })
      expect((await getDevice(actor, id)).events.length).toBe(before)
    })
  })
})
