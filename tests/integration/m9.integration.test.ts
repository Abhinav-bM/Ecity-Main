import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice, updateDevice } from '@/server/services/device.service'
import { increaseStock } from '@/server/services/stock.service'
import { createSale, getSale } from '@/server/services/sale.service'
import { createReturn, inspectDevice } from '@/server/services/return.service'
import {
  approveTransfer,
  dispatchTransfer,
  getTransfer,
  receiveTransfer,
  requestTransfer,
} from '@/server/services/transfer.service'
import { globalSearch } from '@/server/services/search.service'
import {
  deviceCommercials,
  devicePosition,
  deviceTimeline,
} from '@/server/services/device-history.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M9 global search and IMEI device history (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let supplierId: number
  let actor: AuthUser
  /** Assigned to branch A only — the FR-30.7 case. */
  let branchAOnly: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(37_100_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M9 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M9A${stamp}`.slice(0, 12), name: 'M9 Branch A' },
          { businessId, code: `M9B${stamp}`.slice(0, 12), name: 'M9 Branch B' },
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
      name: 'M9 Tester',
      email: 'm9@example.local',
      roleId: 0,
      permissions: new Set([
        'inventory.view',
        'inventory.view_cost',
        'product.view',
        'customer.view',
        'supplier.view',
        'sale.view',
        'purchase.view',
      ]),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    branchAOnly = { ...actor, branchIds: [branchA], canViewAllBranches: false }
    ctx = { actor: null, businessId, branchId: branchA }

    supplierId = (await createParty(actor, ctx, 'supplier', { name: `M9 Supplier ${stamp}` })).id
    const mobiles = await createCategory(actor, ctx, {
      name: 'M9 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M9 Cables', isSerialised: false })
    phoneProductId = (
      await createProduct(actor, ctx, {
        name: `M9 Galaxy ${stamp}`,
        categoryId: mobiles.id,
        sku: `M9SKU${stamp}`.slice(0, 20),
      })
    ).id
    cableProductId = (await createProduct(actor, ctx, { name: 'M9 Cable', categoryId: cables.id }))
      .id
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId: branchA, quantity: 50, movement: 'PURCHASE' },
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
      await clearCustomerCredit(businessId)
      await db.execute(`delete from refund where business_id = ${businessId}`)
      await db.execute(`delete from return_item where return_id in
        (select id from sales_return where business_id = ${businessId})`)
      await db.execute(`delete from sales_return where business_id = ${businessId}`)
      await db.execute(`delete from transfer_item where transfer_id in
        (select id from stock_transfer where business_id = ${businessId})`)
      await db.execute(`delete from stock_transfer where business_id = ${businessId}`)
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
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  /* --- criterion 1: finding a device by any of its identifiers ---------- */

  describe('finding a device by IMEI (FR-30.5)', () => {
    it('a full IMEI goes straight to the device, not to a list of one', async () => {
      const one = imei(1)
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [one],
        mainType: 'GLOBAL',
        branchId: branchA,
      })

      const found = await globalSearch(actor, one)
      expect(found.direct).not.toBeNull()
      expect(found.direct!.kind).toBe('device')
      expect(found.direct!.id).toBe(id)
      expect(found.direct!.href).toBe(`/devices/${id}`)
    })

    it('a partial IMEI lists candidates instead of guessing', async () => {
      const base = imei(2).slice(0, 13)
      await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [`${base}01`],
        mainType: 'USED',
        branchId: branchA,
      })
      await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [`${base}02`],
        mainType: 'USED',
        branchId: branchA,
      })

      const found = await globalSearch(actor, base)
      // Two possible handsets: show both rather than opening one of them.
      expect(found.direct).toBeNull()
      const devices = found.groups.find((g) => g.kind === 'device')
      expect(devices!.hits.length).toBeGreaterThanOrEqual(2)
    })

    it('the second IMEI of a dual-SIM handset opens the same device as the first', async () => {
      const first = imei(3)
      const second = imei(4)
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [first, second],
        mainType: 'GLOBAL',
        branchId: branchA,
      })

      /*
       * The match runs against device_identifier, not the cached primary on
       * device_unit — otherwise only the first IMEI on the box would find the
       * phone, which is exactly the case a counter hits when a customer reads
       * out whichever number is printed nearest.
       */
      const byFirst = await globalSearch(actor, first)
      const bySecond = await globalSearch(actor, second)
      expect(byFirst.direct!.id).toBe(id)
      expect(bySecond.direct!.id).toBe(id)
      expect(bySecond.direct!.href).toBe(byFirst.direct!.href)
    })
  })

  /* --- criterion 2: the whole life of one handset ----------------------- */

  describe('the timeline (FR-30.6)', () => {
    it('shows every stage of a long life, each linked to its document', async () => {
      const one = imei(5)
      const buyer = (await createParty(actor, ctx, 'customer', { name: `M9 Buyer ${stamp}` })).id

      // 1. Purchased.
      const { id: deviceId } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [one],
        mainType: 'GLOBAL',
        isNewCut: true,
        supplierId,
        purchasePricePaise: rs(15000),
        sellingPricePaise: rs(20000),
        branchId: branchA,
      })

      // 2 and 3. Transferred A → B, then back B → A.
      for (const [from, to] of [
        [branchA, branchB],
        [branchB, branchA],
      ] as const) {
        const t = await requestTransfer(actor, ctx, {
          fromBranchId: from,
          toBranchId: to,
          lines: [{ productId: phoneProductId, deviceId, quantity: 1 }],
        })
        await approveTransfer(actor, ctx, t.id)
        await dispatchTransfer(actor, ctx, t.id)
        const detail = await getTransfer(actor, t.id)
        await receiveTransfer(actor, ctx, t.id, [
          { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
        ])
      }

      // 4. Sold on credit.
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [
          { productId: phoneProductId, deviceId, quantity: 1, unitPricePaise: rs(20000) },
        ],
        payments: [],
      })

      // 5. Returned.
      const detail = await getSale(actor, sold.id)
      await createReturn(actor, ctx, {
        saleId: sold.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
      })

      // 6. Inspected and released back to stock.
      await inspectDevice(actor, ctx, { deviceId, grade: 'USED' })

      // 7. Reclassified.
      await updateDevice(actor, ctx, deviceId, { colour: 'Midnight Blue' })

      const timeline = await deviceTimeline(actor, deviceId)
      const types = timeline.map((e) => e.eventType)

      // Every stage FR-30.6 names, in the order it happened.
      expect(types).toContain('PURCHASED')
      expect(types.filter((t) => t === 'TRANSFERRED_OUT')).toHaveLength(2)
      expect(types.filter((t) => t === 'TRANSFERRED_IN')).toHaveLength(2)
      expect(types).toContain('SOLD')
      expect(types).toContain('RETURNED')
      expect(types).toContain('INSPECTED')
      expect(types).toContain('RECLASSIFIED')
      expect(timeline).toEqual([...timeline].sort((a, b) => a.seq - b.seq))

      // The chain has to be walkable: Purchase → Seller, Sale → Customer.
      const purchased = timeline.find((e) => e.eventType === 'PURCHASED')!
      expect(purchased.occurredAt).toBeInstanceOf(Date)

      const soldEntry = timeline.find((e) => e.eventType === 'SOLD')!
      expect(soldEntry.link?.href).toBe(`/sales/${sold.id}`)
      expect(soldEntry.summary).toContain(detail.sale.invoiceNumber)
      expect(soldEntry.summary).toContain(`M9 Buyer ${stamp}`)

      // A transfer entry names both branches and links to the transfer.
      const movedOut = timeline.find((e) => e.eventType === 'TRANSFERRED_OUT')!
      expect(movedOut.fromBranchName).toBe('M9 Branch A')
      expect(movedOut.toBranchName).toBe('M9 Branch B')
      expect(movedOut.link?.href).toMatch(/^\/transfers\/\d+$/)

      const returned = timeline.find((e) => e.eventType === 'RETURNED')!
      expect(returned.link?.href).toMatch(/^\/returns\/\d+$/)

      // Every entry that points at a document resolved to a working link.
      for (const e of timeline) {
        if (e.link) expect(e.link.href).toMatch(/^\/[a-z]+\/\d+$/)
      }
    })

    it('says what a reclassification actually changed', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(6)],
        mainType: 'NEW',
        branchId: branchA,
      })
      await updateDevice(actor, ctx, id, { mainType: 'GLOBAL' })

      const timeline = await deviceTimeline(actor, id)
      const entry = timeline.find((e) => e.eventType === 'RECLASSIFIED')!
      // "Reclassified" alone tells nobody anything.
      expect(entry.summary).toContain('mainType')
    })
  })

  describe('what FR-30.5 asks the page to show', () => {
    it('gives the commercials: discount, payment status, paid versus credit', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `M9 Cred ${stamp}` })).id
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(10)],
        mainType: 'USED',
        purchasePricePaise: rs(12000),
        branchId: branchA,
      })
      const sold = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [
          {
            productId: phoneProductId,
            deviceId: id,
            quantity: 1,
            unitPricePaise: rs(20000),
            discountPaise: rs(1500),
          },
        ],
        // Half down, half on credit.
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(9250) }],
      })

      const [line] = await deviceCommercials(id)
      expect(line!.saleId).toBe(sold.id)
      expect(line!.discountPaise).toBe(rs(1500))
      expect(line!.paymentStatus).toBe('PARTIAL')
      expect(line!.paidPaise).toBe(rs(9250))
      // What is still owed on the bill this handset went out on.
      expect(line!.creditPaise).toBe(line!.saleTotalPaise - rs(9250))
      expect(line!.customerName).toBe(`M9 Cred ${stamp}`)
    })

    it('gives the current position, including where it was before', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(11)],
        mainType: 'USED',
        branchId: branchA,
      })
      // Never moved: there is no previous branch, and saying otherwise would
      // invent one.
      expect((await devicePosition(id)).previousBranchName).toBeNull()

      const t = await requestTransfer(actor, ctx, {
        fromBranchId: branchA,
        toBranchId: branchB,
        lines: [{ productId: phoneProductId, deviceId: id, quantity: 1 }],
      })
      await approveTransfer(actor, ctx, t.id)
      await dispatchTransfer(actor, ctx, t.id)
      const detail = await getTransfer(actor, t.id)
      await receiveTransfer(actor, ctx, t.id, [
        { transferItemId: detail.items[0]!.id, receivedQuantity: 1 },
      ])

      const position = await devicePosition(id)
      expect(position.previousBranchName).toBe('M9 Branch A')
      expect(position.movedAt).toBeInstanceOf(Date)
    })
  })

  /* --- criterion 3: branch scope, at the API --------------------------- */

  describe('branch permissions (FR-30.7)', () => {
    it("a branch-A user cannot find a branch-B customer by phone", async () => {
      const phone = `900${String(stamp).slice(-7)}`
      const theirs = (
        await createParty(actor, ctx, 'customer', { name: `M9 Bee Buyer ${stamp}`, phone })
      ).id

      // They become branch B's customer by buying there.
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchB, quantity: 1, movement: 'PURCHASE' },
      )
      await createSale(actor, ctx, {
        branchId: branchB,
        customerId: theirs,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(500) }],
      })

      // The owner sees them...
      const asOwner = await globalSearch(actor, phone)
      expect(asOwner.groups.find((g) => g.kind === 'customer')?.hits ?? []).toHaveLength(1)

      // ...and someone who only works at branch A does not.
      const asBranchA = await globalSearch(branchAOnly, phone)
      expect(asBranchA.groups.find((g) => g.kind === 'customer')?.hits ?? []).toHaveLength(0)
    })

    it('a customer who has traded at both branches is visible to both', async () => {
      const phone = `711${String(stamp).slice(-7)}`
      const shared = (
        await createParty(actor, ctx, 'customer', { name: `M9 Ess Buyer ${stamp}`, phone })
      ).id
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: shared,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(500) }],
      })

      const asBranchA = await globalSearch(branchAOnly, phone)
      expect(asBranchA.groups.find((g) => g.kind === 'customer')?.hits ?? []).toHaveLength(1)
    })

    it('a branch-A user cannot find a device sitting at branch B', async () => {
      const one = imei(7)
      await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [one],
        mainType: 'USED',
        branchId: branchB,
      })

      expect((await globalSearch(actor, one)).direct).not.toBeNull()
      const scoped = await globalSearch(branchAOnly, one)
      expect(scoped.direct).toBeNull()
      expect(scoped.total).toBe(0)
    })

    it('returns nothing for a kind the user has no permission to see', async () => {
      const blind: AuthUser = { ...actor, permissions: new Set<string>() as AuthUser['permissions'] }
      const found = await globalSearch(blind, `M9 Galaxy ${stamp}`)
      expect(found.total).toBe(0)
    })
  })

  /* --- criterion 4: it has to be fast ---------------------------------- */

  describe('performance (PRD §9.1)', () => {
    it('assembles a 50-event history well inside 1.5 s', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(8)],
        mainType: 'USED',
        branchId: branchA,
      })

      /*
       * A real device reaches this many events over years of transfers,
       * inspections and repairs. Written directly because the point is the
       * read path, not how they got there.
       */
      await db.insert(schema.deviceEvent).values(
        Array.from({ length: 49 }, (_, i) => ({
          deviceId: id,
          seq: i + 2,
          eventType: 'ADJUSTED' as const,
          branchId: branchA,
          refType: 'stock_adjustment',
          refId: 1,
        })),
      )

      const started = performance.now()
      const timeline = await deviceTimeline(actor, id)
      const elapsed = performance.now() - started

      expect(timeline).toHaveLength(50)
      expect(elapsed).toBeLessThan(1500)
    })

    it('resolves documents in one query per type, not one per event', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: phoneProductId,
        identifiers: [imei(9)],
        mainType: 'USED',
        branchId: branchA,
      })
      // Thirty events all pointing at the same sale.
      await db.insert(schema.deviceEvent).values(
        Array.from({ length: 30 }, (_, i) => ({
          deviceId: id,
          seq: i + 2,
          eventType: 'RESERVED' as const,
          branchId: branchA,
        })),
      )

      const started = performance.now()
      await deviceTimeline(actor, id)
      // A round trip per event would put this far past a second.
      expect(performance.now() - started).toBeLessThan(500)
    })
  })

  /* --- the rest of FR-30.2 --------------------------------------------- */

  describe('searching everything else (FR-30.2 – FR-30.4)', () => {
    it('finds a product by name and by SKU', async () => {
      const byName = await globalSearch(actor, `M9 Galaxy ${stamp}`)
      expect(byName.groups.find((g) => g.kind === 'product')?.hits ?? []).toHaveLength(1)

      const bySku = await globalSearch(actor, `M9SKU${stamp}`.slice(0, 20))
      expect(bySku.groups.find((g) => g.kind === 'product')?.hits ?? []).toHaveLength(1)
    })

    it('finds a supplier by name', async () => {
      const found = await globalSearch(actor, `M9 Supplier ${stamp}`)
      expect(found.groups.find((g) => g.kind === 'supplier')?.hits ?? []).toHaveLength(1)
    })

    it('finds an invoice by its number', async () => {
      const sales = await db
        .select({ invoiceNumber: schema.sale.invoiceNumber })
        .from(schema.sale)
        .where(eq(schema.sale.businessId, businessId))
        .limit(1)
      const number = sales[0]!.invoiceNumber

      const found = await globalSearch(actor, number)
      const hits = found.groups.find((g) => g.kind === 'sale')?.hits ?? []
      expect(hits.some((h) => h.title === number)).toBe(true)
    })

    it('ignores a query too short to mean anything', async () => {
      expect((await globalSearch(actor, 'a')).total).toBe(0)
      expect((await globalSearch(actor, '   ')).total).toBe(0)
    })
  })
})
