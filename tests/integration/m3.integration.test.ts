import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import {
  createPurchase,
  getPurchase,
  listPurchases,
  reversePurchase,
} from '@/server/services/purchase.service'
import {
  openPurchasesForSupplier,
  recordSupplierPayment,
  voidSupplierPayment,
} from '@/server/services/supplier-payment.service'
import {
  supplierBalance,
  supplierHistory,
  supplierOutstanding,
} from '@/server/services/supplier-ledger.service'
import { getStock, setDeviceStatus } from '@/server/services/stock.service'
import { listDevices } from '@/server/services/device.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M3 purchases and supplier ledger (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let supplierId: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(35_100_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (rupees: number) => BigInt(rupees) * 100n

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M3 Test ${stamp}` }).returning()
    )[0]!.id
    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `M3${stamp}`.slice(0, 12), name: 'M3 Branch' })
        .returning()
    )[0]!.id
    cashMethodId = (
      await db
        .insert(schema.paymentMethod)
        .values({ businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M3 Tester',
      email: 'm3@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    supplierId = (await createParty(actor, ctx, 'supplier', { name: `Distributor ${stamp}` })).id
    const mobiles = await createCategory(actor, ctx, {
      name: 'M3 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M3 Cables', isSerialised: false })
    phoneProductId = (
      await createProduct(actor, ctx, { name: 'Test Phone Pro', categoryId: mobiles.id })
    ).id
    cableProductId = (
      await createProduct(actor, ctx, { name: 'Test Cable', categoryId: cables.id })
    ).id
  })

  afterAll(async () => {
    if (!available) return
    await db.execute('alter table device_event disable trigger user')
    await db.execute('alter table stock_ledger disable trigger user')
    await db.execute('alter table supplier_ledger_entry disable trigger user')
    await db.execute('alter table audit_log disable trigger user')
    try {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      if (devices.length) {
        const ids = devices.map((d) => d.id)
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db.delete(schema.deviceIdentifier).where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from supplier_payment_allocation where payment_id in
        (select id from supplier_payment where business_id = ${businessId})`)
      await db.delete(schema.supplierPayment).where(eq(schema.supplierPayment.businessId, businessId))
      await db.execute(`delete from supplier_ledger_entry where business_id = ${businessId}`)
      await db.execute(`delete from purchase_item where purchase_id in
        (select id from purchase where business_id = ${businessId})`)
      await db.delete(schema.purchase).where(eq(schema.purchase.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db.delete(schema.documentSequence).where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    } finally {
      await db.execute('alter table device_event enable trigger user')
      await db.execute('alter table stock_ledger enable trigger user')
      await db.execute('alter table supplier_ledger_entry enable trigger user')
      await db.execute('alter table audit_log enable trigger user')
    }
  })

  describe('confirming a purchase — the M3 acceptance case', () => {
    let purchaseId: number

    it('5 mobiles and 20 accessories: stock rises and 5 devices are registered', async () => {
      const result = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        supplierInvoiceNumber: `INV-${stamp}`,
        lines: [
          {
            productId: phoneProductId,
            quantity: 5,
            unitCostPaise: rs(20000),
            mainType: 'NEW',
            identifiers: [imei(1), imei(2), imei(3), imei(4), imei(5)],
          },
          { productId: cableProductId, quantity: 20, unitCostPaise: rs(100) },
        ],
      })
      purchaseId = result.id

      expect(result.purchaseNumber).toMatch(/^PUR-\d{5}$/)
      expect(result.deviceIds).toHaveLength(5)

      // Accessory stock rose by exactly 20.
      expect((await getStock(cableProductId, branchA))!.quantity).toBe(20)

      // Five devices, all NEW, all with an identifier and a primary.
      const devices = await listDevices(actor, { productId: phoneProductId, page: 1, pageSize: 20 })
      expect(devices.total).toBe(5)
      expect(devices.rows.every((d) => d.mainType === 'NEW')).toBe(true)
      expect(devices.rows.every((d) => d.primaryIdentifier)).toBe(true)

      // Cost carried from the line onto each unit.
      const detail = await getPurchase(actor, purchaseId)
      expect(detail.purchase.totalPaise).toBe(rs(20000) * 5n + rs(100) * 20n)
      expect(detail.devices).toHaveLength(5)
    })

    it('the supplier is now owed the full amount', async () => {
      expect(await supplierBalance(supplierId)).toBe(rs(20000) * 5n + rs(100) * 20n)
    })

    it('every device links back to its purchase line', async () => {
      const detail = await getPurchase(actor, purchaseId)
      const line = detail.items.find((i) => i.isSerialised)!
      expect(detail.devices.every((d) => d.purchaseItemId === line.id)).toBe(true)
    })

    it('numbers are sequential and unique', async () => {
      const second = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitCostPaise: rs(100) }],
      })
      const first = await getPurchase(actor, purchaseId)
      expect(second.purchaseNumber).not.toBe(first.purchase.purchaseNumber)
      expect(Number(second.purchaseNumber.slice(4))).toBeGreaterThan(
        Number(first.purchase.purchaseNumber.slice(4)),
      )
    })
  })

  describe('gapless numbering under concurrency', () => {
    it('ten simultaneous purchases take ten distinct numbers', async () => {
      // The bug this guards against: with NULLS NOT DISTINCT missing, every
      // call inserted its own counter row at 1 and numbers collided.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          createPurchase(actor, ctx, {
            supplierId,
            branchId: branchA,
            lines: [{ productId: cableProductId, quantity: 1, unitCostPaise: rs(10) }],
          }),
        ),
      )
      const numbers = results.map((r) => r.purchaseNumber)
      expect(new Set(numbers).size, `collision among ${numbers.join(', ')}`).toBe(10)
    })

    it('uses exactly one counter row per business and kind', async () => {
      const rows = await db
        .select()
        .from(schema.documentSequence)
        .where(eq(schema.documentSequence.businessId, businessId))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.kind).toBe('purchase')
    })
  })

  describe('line validation', () => {
    it('refuses a serialised line whose identifier count does not match quantity', async () => {
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            {
              productId: phoneProductId,
              quantity: 3,
              unitCostPaise: rs(100),
              mainType: 'NEW',
              identifiers: [imei(20), imei(21)],
            },
          ],
        }),
      ).rejects.toThrow(/3 units ordered but 2 identifiers entered/)
    })

    it('refuses a serialised line with no main type', async () => {
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            { productId: phoneProductId, quantity: 1, unitCostPaise: rs(100), identifiers: [imei(30)] },
          ],
        }),
      ).rejects.toThrow(/choose a main type/i)
    })

    it('refuses NEW CUT outside GLOBAL on a line', async () => {
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            {
              productId: phoneProductId,
              quantity: 1,
              unitCostPaise: rs(100),
              mainType: 'USED',
              isNewCut: true,
              identifiers: [imei(31)],
            },
          ],
        }),
      ).rejects.toThrow(/only to GLOBAL/i)
    })

    it('refuses identifiers on a counted line', async () => {
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            {
              productId: cableProductId,
              quantity: 2,
              unitCostPaise: rs(100),
              identifiers: [imei(32)],
            },
          ],
        }),
      ).rejects.toThrow(/counted by quantity/i)
    })

    it('refuses a duplicate IMEI, naming the conflicting device', async () => {
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            {
              productId: phoneProductId,
              quantity: 1,
              unitCostPaise: rs(100),
              mainType: 'NEW',
              identifiers: [imei(1)],
            },
          ],
        }),
      ).rejects.toThrow(/already belongs to Test Phone Pro/)
    })

    it('leaves nothing behind when a line is rejected', async () => {
      const before = await listPurchases(actor, { page: 1, pageSize: 100 })
      await expect(
        createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [
            { productId: cableProductId, quantity: 5, unitCostPaise: rs(50) },
            {
              productId: phoneProductId,
              quantity: 1,
              unitCostPaise: rs(100),
              mainType: 'NEW',
              identifiers: [imei(1)],
            },
          ],
        }),
      ).rejects.toThrow()
      const after = await listPurchases(actor, { page: 1, pageSize: 100 })
      // The whole transaction rolled back - no orphan purchase, no extra stock.
      expect(after.total).toBe(before.total)
    })
  })

  describe('paying a supplier', () => {
    let payPurchaseId: number

    beforeAll(async () => {
      payPurchaseId = (
        await createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [{ productId: cableProductId, quantity: 10, unitCostPaise: rs(500) }],
        })
      ).id
    })

    it('a partial payment leaves the right outstanding', async () => {
      const balanceBefore = await supplierBalance(supplierId)
      await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1000),
        allocations: [{ purchaseId: payPurchaseId, amountPaise: rs(1000) }],
      })
      expect(await supplierBalance(supplierId)).toBe(balanceBefore - rs(1000))

      const detail = await getPurchase(actor, payPurchaseId)
      expect(detail.paidPaise).toBe(rs(1000))
      expect(detail.paymentStatus).toBe('PARTIAL')
    })

    it('paying the rest marks it PAID', async () => {
      const detail = await getPurchase(actor, payPurchaseId)
      const owing = detail.purchase.totalPaise - detail.paidPaise
      await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: owing,
        allocations: [{ purchaseId: payPurchaseId, amountPaise: owing }],
      })
      expect((await getPurchase(actor, payPurchaseId)).paymentStatus).toBe('PAID')
    })

    it('refuses to allocate more than a purchase owes', async () => {
      await expect(
        recordSupplierPayment(actor, ctx, {
          supplierId,
          branchId: branchA,
          paymentMethodId: cashMethodId,
          amountPaise: rs(100),
          allocations: [{ purchaseId: payPurchaseId, amountPaise: rs(100) }],
        }),
      ).rejects.toThrow(/more than the purchase still owes/i)
    })

    it('allocates oldest-first when told nothing', async () => {
      const open = await openPurchasesForSupplier(actor, supplierId)
      expect(open.length).toBeGreaterThan(0)
      const oldest = open[0]!
      await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: oldest.owingPaise,
      })
      expect((await getPurchase(actor, oldest.id)).paymentStatus).toBe('PAID')
    })

    it('voiding a payment restores the debt without editing history', async () => {
      const target = (
        await createPurchase(actor, ctx, {
          supplierId,
          branchId: branchA,
          lines: [{ productId: cableProductId, quantity: 2, unitCostPaise: rs(250) }],
        })
      ).id
      const { id: paymentId } = await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(500),
        allocations: [{ purchaseId: target, amountPaise: rs(500) }],
      })
      expect((await getPurchase(actor, target)).paymentStatus).toBe('PAID')

      const before = await supplierBalance(supplierId)
      await voidSupplierPayment(actor, ctx, paymentId, 'cheque bounced')
      expect(await supplierBalance(supplierId)).toBe(before + rs(500))
      expect((await getPurchase(actor, target)).paymentStatus).toBe('UNPAID')
    })

    it('the supplier ledger cannot be rewritten', async () => {
      await expect(
        db.execute(`update supplier_ledger_entry set amount_paise = 0 where business_id = ${businessId}`),
      ).rejects.toThrow(/append-only/i)
    })
  })

  describe('reversal — PRD FR-5.15', () => {
    it('reverses an untouched purchase, removing stock and the debt', async () => {
      const { id } = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        lines: [
          {
            productId: phoneProductId,
            quantity: 2,
            unitCostPaise: rs(15000),
            mainType: 'USED',
            identifiers: [imei(40), imei(41)],
          },
          { productId: cableProductId, quantity: 5, unitCostPaise: rs(100) },
        ],
      })
      const stockBefore = (await getStock(cableProductId, branchA))!.quantity
      const balanceBefore = await supplierBalance(supplierId)

      await reversePurchase(actor, ctx, id, 'wrong delivery')

      expect((await getPurchase(actor, id)).purchase.status).toBe('REVERSED')
      expect((await getStock(cableProductId, branchA))!.quantity).toBe(stockBefore - 5)
      expect(await supplierBalance(supplierId)).toBe(
        balanceBefore - (rs(15000) * 2n + rs(100) * 5n),
      )
      // Its units are VOIDED rather than deleted - inventory records move to a
      // state, they do not disappear - so they drop out of the stock list...
      const inStock = await listDevices(actor, { search: imei(40), page: 1, pageSize: 5 })
      expect(inStock.total).toBe(0)

      // ...but remain findable, with their history, when asked for directly.
      const voided = await listDevices(actor, {
        search: imei(40),
        status: 'VOIDED',
        page: 1,
        pageSize: 5,
      })
      expect(voided.total).toBe(1)

      // And crucially the IMEI is released, so a corrected purchase can
      // re-enter the same handset.
      const corrected = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        lines: [
          {
            productId: phoneProductId,
            quantity: 1,
            unitCostPaise: rs(15000),
            mainType: 'USED',
            identifiers: [imei(40)],
          },
        ],
      })
      expect(corrected.deviceIds).toHaveLength(1)
    })

    it('refuses when a device has already moved on, naming it', async () => {
      const { id, deviceIds } = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        lines: [
          {
            productId: phoneProductId,
            quantity: 2,
            unitCostPaise: rs(15000),
            mainType: 'USED',
            identifiers: [imei(50), imei(51)],
          },
        ],
      })
      await setDeviceStatus(
        { businessId },
        { deviceId: deviceIds[0]!, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
      )

      await expect(reversePurchase(actor, ctx, id, 'oops')).rejects.toThrow(
        /already moved on/i,
      )
      // And the message names the blocking IMEI.
      await expect(reversePurchase(actor, ctx, id, 'oops')).rejects.toThrow(
        new RegExp(imei(50)),
      )
      // Nothing was undone by the failed attempt.
      expect((await getPurchase(actor, id)).purchase.status).toBe('CONFIRMED')
    })

    it('refuses to reverse a purchase that has been paid', async () => {
      const { id } = await createPurchase(actor, ctx, {
        supplierId,
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitCostPaise: rs(300) }],
      })
      await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(300),
        allocations: [{ purchaseId: id, amountPaise: rs(300) }],
      })
      await expect(reversePurchase(actor, ctx, id, 'nope')).rejects.toThrow(/has payments/i)
    })
  })

  describe('supplier reporting', () => {
    it('outstanding lists the supplier with their balance', async () => {
      const rows = await supplierOutstanding(actor)
      const row = rows.find((r) => r.supplierId === supplierId)
      expect(row).toBeTruthy()
      expect(row!.purchaseCount).toBeGreaterThan(0)
      expect(row!.balancePaise).toBe(await supplierBalance(supplierId))
    })

    it('history shows purchases, payments and the balance (FR-5.11)', async () => {
      const history = await supplierHistory(actor, supplierId)
      expect(history.purchases.length).toBeGreaterThan(0)
      expect(history.payments.length).toBeGreaterThan(0)
      expect(history.balancePaise).toBe(await supplierBalance(supplierId))
      expect(history.purchases.every((p) => ['UNPAID', 'PARTIAL', 'PAID'].includes(p.paymentStatus))).toBe(true)
    })

    it('the balance always equals the sum of the ledger', async () => {
      const rows = await db
        .select({ amount: schema.supplierLedgerEntry.amountPaise })
        .from(schema.supplierLedgerEntry)
        .where(eq(schema.supplierLedgerEntry.supplierId, supplierId))
      const recomputed = rows.reduce((sum, r) => sum + r.amount, 0n)
      expect(await supplierBalance(supplierId)).toBe(recomputed)
    })
  })
})
