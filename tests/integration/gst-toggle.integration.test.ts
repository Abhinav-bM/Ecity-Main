import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice } from '@/server/services/device.service'
import { getInvoiceData } from '@/server/services/invoice'
import { createSale, getSale } from '@/server/services/sale.service'
import { updateBusiness } from '@/server/services/business.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

/**
 * A shop that is not registered for GST.
 *
 * The point of these tests is the pair of switches: the business setting says
 * what the shop is NOW, and `sale.gst_enabled` says what it WAS when the bill
 * was issued. Nothing archives the invoice PDF - every reprint is a fresh
 * render - so if the second one were ever read from the first, registering for
 * GST would silently turn every old bill into a tax invoice.
 */
suite('GST toggle (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let customerId: number
  let phoneProductId: number
  let cashMethodId: number
  let gst18Id: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(35_900_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))

  async function stockPhone(n: number) {
    const { id } = await createDevice(actor, ctx, {
      productId: phoneProductId,
      identifiers: [imei(n)],
      mainType: 'USED',
      sellingPricePaise: rs(10000),
      branchId: branchA,
    })
    return id
  }

  async function setGst(on: boolean) {
    await updateBusiness(actor, ctx, { gstEnabled: on })
  }

  /** One handset at ₹10,000, billed and paid in cash. */
  async function sellOne(n: number) {
    const deviceId = await stockPhone(n)
    return createSale(actor, ctx, {
      branchId: branchA,
      customerId,
      lines: [
        {
          productId: phoneProductId,
          deviceId,
          quantity: 1,
          unitPricePaise: rs(10000),
          taxRateId: gst18Id,
        },
      ],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(10000) }],
    })
  }

  beforeAll(async () => {
    businessId = (
      await db
        .insert(schema.business)
        .values({ name: `GST Test ${stamp}`, gstin: '29ABCDE1234F1Z5', stateCode: '29' })
        .returning()
    )[0]!.id
    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `GSTA${stamp}`.slice(0, 12), name: 'GST Branch' })
        .returning()
    )[0]!.id

    cashMethodId = (
      await db
        .insert(schema.paymentMethod)
        .values({ businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true })
        .returning()
    )[0]!.id

    gst18Id = (
      await db
        .insert(schema.taxRate)
        .values({ businessId, name: 'GST 18%', rateBasisPoints: 1800, isDefault: true })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'GST Tester',
      email: 'gst@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    customerId = (await createParty(actor, ctx, 'customer', { name: `GST Buyer ${stamp}` })).id
    const mobiles = await createCategory(actor, ctx, {
      name: 'GST Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    phoneProductId = (
      await createProduct(actor, ctx, {
        name: 'GST Phone',
        categoryId: mobiles.id,
        hsnCode: '8517',
        taxRateId: gst18Id,
      })
    ).id
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
      await clearCustomerCredit(businessId)
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

  describe('with GST off', () => {
    it('charges no tax even when the line asks for a rate', async () => {
      await setGst(false)
      const sold = await sellOne(1)
      const detail = await getSale(actor, sold.id)

      // The request carried an 18% rate. An unregistered shop charges none, so
      // the server forces it to zero rather than trusting what was sent.
      expect(detail.sale.taxPaise).toBe(0n)
      expect(detail.sale.cgstPaise).toBe(0n)
      expect(detail.sale.sgstPaise).toBe(0n)
      expect(detail.sale.igstPaise).toBe(0n)
      // The customer pays the price on the label, not the price plus tax.
      expect(detail.sale.totalPaise).toBe(rs(10000))
      expect(detail.sale.taxablePaise).toBe(rs(10000))
      expect(detail.items[0]!.taxRateBasisPoints).toBe(0)
      expect(detail.items[0]!.taxRateId).toBeNull()
    })

    it('leaves no GST detail on the bill to print', async () => {
      await setGst(false)
      const sold = await sellOne(2)
      const detail = await getSale(actor, sold.id)

      expect(detail.sale.gstEnabled).toBe(false)
      expect(detail.sale.placeOfSupplyCode).toBeNull()
      expect(detail.sale.isInterState).toBe(false)
      // HSN is a GST code; it has no meaning on a bill from an unregistered
      // dealer, so it is not snapshotted onto the line.
      expect(detail.items[0]!.hsnCodeSnapshot).toBeNull()

      const invoice = await getInvoiceData(actor, sold.id)
      expect(invoice.gstEnabled).toBe(false)
      expect(invoice.gst.hsnSummary).toHaveLength(0)
    })
  })

  describe('with GST on', () => {
    it('charges tax and stamps the bill as a tax invoice', async () => {
      await setGst(true)
      const sold = await sellOne(3)
      const detail = await getSale(actor, sold.id)

      expect(detail.sale.gstEnabled).toBe(true)
      expect(detail.sale.taxPaise).toBeGreaterThan(0n)
      expect(detail.sale.totalPaise).toBe(rs(10000))
      expect(detail.items[0]!.hsnCodeSnapshot).toBe('8517')

      const invoice = await getInvoiceData(actor, sold.id)
      expect(invoice.gstEnabled).toBe(true)
      expect(invoice.gst.hsnSummary.length).toBeGreaterThan(0)
    })
  })

  describe('registering later does not rewrite history', () => {
    it('a bill issued before registration still prints as a plain invoice', async () => {
      // Sell while unregistered...
      await setGst(false)
      const before = await sellOne(4)
      // ...then the shop registers.
      await setGst(true)
      const after = await sellOne(5)

      /*
       * This is the whole reason the flag lives on the sale. Nothing archives
       * the PDF, so this reprint is a fresh render - if it read the business
       * setting it would now claim to be a tax invoice carrying a GSTIN the
       * shop did not have when the bill was issued.
       */
      const old = await getInvoiceData(actor, before.id)
      expect(old.gstEnabled).toBe(false)
      expect(old.taxPaise).toBe(0n)
      expect(old.gst.hsnSummary).toHaveLength(0)

      const fresh = await getInvoiceData(actor, after.id)
      expect(fresh.gstEnabled).toBe(true)
      expect(fresh.taxPaise).toBeGreaterThan(0n)
    })

    it('and de-registering does not strip GST off bills already issued', async () => {
      await setGst(true)
      const taxed = await sellOne(6)
      await setGst(false)

      const reprint = await getInvoiceData(actor, taxed.id)
      expect(reprint.gstEnabled).toBe(true)
      expect(reprint.taxPaise).toBeGreaterThan(0n)
    })
  })
})
