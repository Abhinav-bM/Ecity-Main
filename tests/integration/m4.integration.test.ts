import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice } from '@/server/services/device.service'
import { increaseStock, getStock } from '@/server/services/stock.service'
import { createSale, getSale, listSales } from '@/server/services/sale.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M4 sales and billing (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let customerId: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let upiMethodId: number
  let gst18Id: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(35_300_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))

  async function stockDevice(mainType: 'NEW' | 'USED' | 'GLOBAL', n: number, branchId = branchA) {
    const { id } = await createDevice(actor, ctx, {
      productId: phoneProductId,
      identifiers: [imei(n)],
      mainType,
      sellingPricePaise: rs(20000),
      branchId,
    })
    return id
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M4 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M4A${stamp}`.slice(0, 12), name: 'M4 Branch A' },
          { businessId, code: `M4B${stamp}`.slice(0, 12), name: 'M4 Branch B' },
        ])
        .returning()
    ).map((b) => b.id) as [number, number]

    const methods = await db
      .insert(schema.paymentMethod)
      .values([
        { businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true },
        { businessId, code: 'UPI', name: 'UPI', type: 'UPI' },
      ])
      .returning()
    cashMethodId = methods[0]!.id
    upiMethodId = methods[1]!.id

    gst18Id = (
      await db
        .insert(schema.taxRate)
        .values({ businessId, name: 'GST 18%', rateBasisPoints: 1800, isDefault: true })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M4 Tester',
      email: 'm4@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    customerId = (await createParty(actor, ctx, 'customer', { name: `Buyer ${stamp}` })).id
    const mobiles = await createCategory(actor, ctx, {
      name: 'M4 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M4 Cables', isSerialised: false })
    phoneProductId = (await createProduct(actor, ctx, { name: 'M4 Phone', categoryId: mobiles.id })).id
    cableProductId = (await createProduct(actor, ctx, { name: 'M4 Cable', categoryId: cables.id })).id

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
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db.delete(schema.deviceIdentifier).where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db.delete(schema.documentSequence).where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.taxRate).where(eq(schema.taxRate.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('an accessory sale', () => {
    it('takes stock out and posts the payment', async () => {
      const before = (await getStock(cableProductId, branchA))!.quantity
      const { invoiceNumber } = await createSale(actor, ctx, {
        branchId: branchA,
        lines: [
          { productId: cableProductId, quantity: 2, unitPricePaise: rs(200), taxRateId: gst18Id },
        ],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(400) }],
      })
      expect(invoiceNumber).toMatch(/^INV-\d{5}$/)
      expect((await getStock(cableProductId, branchA))!.quantity).toBe(before - 2)
    })

    it('needs no customer — a walk-in paying cash', async () => {
      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(100) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(100) }],
      })
      expect((await getSale(actor, id)).sale.customerId).toBeNull()
    })

    it('refuses to sell more than the branch holds', async () => {
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: cableProductId, quantity: 99999, unitPricePaise: rs(1) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(99999) }],
        }),
      ).rejects.toThrow(/Not enough stock/i)
    })
  })

  describe('a device sale', () => {
    it('marks the exact handset SOLD and snapshots its classification', async () => {
      const deviceId = await stockDevice('GLOBAL', 1)
      await db
        .update(schema.deviceUnit)
        .set({ isNewCut: true })
        .where(eq(schema.deviceUnit.id, deviceId))

      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [
          { productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000), taxRateId: gst18Id },
        ],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
      })

      const detail = await getSale(actor, id)
      expect(detail.items[0]!.mainTypeSnapshot).toBe('GLOBAL')
      expect(detail.items[0]!.isNewCutSnapshot).toBe(true)
      expect(detail.items[0]!.identifierSnapshot).toBe(imei(1))

      const device = (
        await db.select().from(schema.deviceUnit).where(eq(schema.deviceUnit.id, deviceId))
      )[0]!
      expect(device.status).toBe('SOLD')
    })

    it('refuses a NEW device — it is billed in the other system (FR-38.2)', async () => {
      const deviceId = await stockDevice('NEW', 2)
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
        }),
      ).rejects.toThrow(/billed through the other system/i)
    })

    it('refuses a device that is at another branch', async () => {
      const deviceId = await stockDevice('USED', 3, branchB)
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
        }),
      ).rejects.toThrow(/not at this branch/i)
    })

    it('two tills cannot sell the same handset', async () => {
      const deviceId = await stockDevice('USED', 4)
      const attempt = () =>
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(15000) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(15000) }],
        })

      const results = await Promise.allSettled([attempt(), attempt()])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected')
      expect(ok, 'exactly one sale must succeed').toHaveLength(1)
      expect(failed).toHaveLength(1)

      // And the device is SOLD exactly once.
      const events = await db
        .select()
        .from(schema.deviceEvent)
        .where(eq(schema.deviceEvent.deviceId, deviceId))
      expect(events.filter((e) => e.eventType === 'SOLD')).toHaveLength(1)
    })
  })

  describe('money', () => {
    it('splits payment across methods', async () => {
      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(1000), taxRateId: gst18Id }],
        payments: [
          { paymentMethodId: cashMethodId, amountPaise: rs(400) },
          { paymentMethodId: upiMethodId, amountPaise: rs(600) },
        ],
      })
      const detail = await getSale(actor, id)
      expect(detail.payments).toHaveLength(2)
      expect(detail.paidPaise).toBe(rs(1000))
      expect(detail.paymentStatus).toBe('PAID')
    })

    it('an underpaid bill is credit, and credit needs a customer', async () => {
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(100) }],
        }),
      ).rejects.toThrow(/walk-in cannot be given credit/i)

      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(100) }],
      })
      expect((await getSale(actor, id)).paymentStatus).toBe('PARTIAL')
    })

    it('refuses payment greater than the bill', async () => {
      await expect(
        createSale(actor, ctx, {
          branchId: branchA,
          lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(100) }],
          payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(500) }],
        }),
      ).rejects.toThrow(/more than the bill total/i)
    })

    it('the invoice adds up: taxable plus tax equals the total', async () => {
      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        lines: [
          { productId: cableProductId, quantity: 3, unitPricePaise: 33333n, taxRateId: gst18Id },
        ],
        payments: [],
        customerId,
      })
      const d = await getSale(actor, id)
      expect(d.sale.taxablePaise + d.sale.taxPaise).toBe(d.sale.totalPaise)
      const lineSum = d.items.reduce((s, i) => s + i.lineTotalPaise, 0n)
      expect(lineSum).toBe(d.sale.totalPaise)
    })
  })

  describe('idempotency — PRD NFR §9.3', () => {
    it('a retried submission returns the original bill, not a second one', async () => {
      const key = `idem-${stamp}`
      const body = {
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(250) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(250) }],
        idempotencyKey: key,
      }
      const first = await createSale(actor, ctx, body)
      const second = await createSale(actor, ctx, body)

      expect(second.id).toBe(first.id)
      expect(second.reused).toBe(true)
      expect(second.invoiceNumber).toBe(first.invoiceNumber)

      const all = await listSales(actor, { search: first.invoiceNumber, page: 1, pageSize: 10 })
      expect(all.total, 'only one bill may exist').toBe(1)
    })
  })

  describe('invoice numbering', () => {
    it('is gapless and unique under 200 concurrent sales', async () => {
      // M4 acceptance criterion. The counter allocates from document_sequence
      // under SELECT ... FOR UPDATE, so this is the test that proves two tills
      // hitting save at the same instant cannot share or skip a number - which
      // a GST audit would treat as a missing invoice.
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 200, movement: 'PURCHASE' },
      )

      const results = await Promise.all(
        Array.from({ length: 200 }, () =>
          createSale(actor, ctx, {
            branchId: branchA,
            lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(10) }],
            payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(10) }],
          }),
        ),
      )

      const numbers = results.map((r) => r.invoiceNumber)
      expect(new Set(numbers).size, 'duplicate invoice number').toBe(200)

      // Unique is not enough: the series must also have no holes.
      const counters = numbers.map((n) => Number(n.slice(n.lastIndexOf('/') + 1))).sort((a, b) => a - b)
      const first = counters[0]!
      const expected = Array.from({ length: 200 }, (_, i) => first + i)
      expect(counters, `gap in the series starting at ${first}`).toEqual(expected)
    }, 120_000)

    it('a branch with its own prefix gets its own series (FR-26.3)', async () => {
      await db
        .update(schema.branch)
        .set({ invoicePrefix: 'BR2' })
        .where(eq(schema.branch.id, branchB))
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchB, quantity: 5, movement: 'PURCHASE' },
      )
      const { invoiceNumber } = await createSale(actor, ctx, {
        branchId: branchB,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(50) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(50) }],
      })
      expect(invoiceNumber).toMatch(/^BR2-\d{5}$/)
    })
  })
})
