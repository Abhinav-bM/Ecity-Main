import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import {
  assertClassificationValid,
  createDevice,
  findDeviceByIdentifier,
  getDevice,
  listDevices,
  mainTypeSummary,
  normaliseIdentifiers,
} from '@/server/services/device.service'
import { createCategory, createProduct, listLowStock, setMinQuantity } from '@/server/services/product.service'
import {
  appendDeviceEvent,
  canTransition,
  decreaseStock,
  defaultSalesChannel,
  getStock,
  increaseStock,
  setDeviceStatus,
} from '@/server/services/stock.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M2 inventory core (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let mobileProductId: number
  let accessoryProductId: number
  let actor: AuthUser
  let ctx: AuditContext
  /** IMEIs must be 14-17 digits and unique across the business. */
  const imei = (n: number) => String(10_000_000_000_000 + (stamp % 1_000_000) * 100 + n)

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M2 Test ${stamp}` }).returning()
    )[0]!.id
    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `A${stamp}`.slice(0, 12), name: 'Branch A' })
        .returning()
    )[0]!.id
    branchB = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `B${stamp}`.slice(0, 12), name: 'Branch B' })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M2 Tester',
      email: 'm2@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    const mobiles = await createCategory(actor, ctx, { name: 'Mobiles', isSerialised: true })
    const accessories = await createCategory(actor, ctx, { name: 'Cables', isSerialised: false })
    mobileProductId = (
      await createProduct(actor, ctx, { name: 'Test Phone 5G', categoryId: mobiles.id })
    ).id
    accessoryProductId = (
      await createProduct(actor, ctx, { name: 'USB-C Cable', categoryId: accessories.id })
    ).id
  })

  afterAll(async () => {
    if (!available) return
    // device_event and stock_ledger are append-only by trigger, which is the
    // point — production must never be able to rewrite a device's history.
    // Test teardown is the one legitimate exception, so the triggers are
    // disabled for these statements only and restored immediately.
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      for (const d of devices) {
        await db.execute(`delete from device_event where device_id = ${d.id}`)
        await db.delete(schema.deviceIdentifier).where(eq(schema.deviceIdentifier.deviceId, d.id))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
    })
    await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, accessoryProductId))
    await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
    await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
    await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
    await db.delete(schema.business).where(eq(schema.business.id, businessId))
  })

  describe('classification — PRD §5.1', () => {
    it('accepts all five main types', async () => {
      for (const [i, mainType] of (['NEW', 'USED', 'ER', 'ACT', 'GLOBAL'] as const).entries()) {
        const r = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [imei(i)],
          mainType,
          branchId: branchA,
        })
        expect(r.id, mainType).toBeGreaterThan(0)
      }
    })

    it('allows NEW CUT on GLOBAL', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(10)],
        mainType: 'GLOBAL',
        isNewCut: true,
        newCutNotes: 'cut in transit',
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.device.mainType).toBe('GLOBAL')
      expect(d.device.isNewCut).toBe(true)
    })

    it('refuses NEW CUT on any other type, at the service layer', () => {
      for (const mainType of ['NEW', 'USED', 'ER', 'ACT'] as const) {
        expect(() => assertClassificationValid({ mainType, isNewCut: true }), mainType).toThrow(
          /only to GLOBAL/i,
        )
      }
    })

    it('refuses NEW CUT on any other type, at the DATABASE', async () => {
      // Bypassing the service entirely, as an import or a script would.
      await expect(
        db.insert(schema.deviceUnit).values({
          businessId,
          productId: mobileProductId,
          mainType: 'USED',
          isNewCut: true,
        }),
      ).rejects.toThrow(/new_cut_only_global/i)
    })

    it('defaults NEW devices to the external billing channel (FR-38.1)', async () => {
      expect(defaultSalesChannel('NEW')).toBe('EXTERNAL')
      expect(defaultSalesChannel('USED')).toBe('ECITY')
      expect(defaultSalesChannel('GLOBAL')).toBe('ECITY')
    })
  })

  describe('identifiers — PRD FR-4.8 to FR-4.12', () => {
    it('stores three IMEIs and marks exactly one primary', async () => {
      const imeis = [imei(20), imei(21), imei(22)]
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: imeis,
        mainType: 'USED',
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.identifiers).toHaveLength(3)
      expect(d.identifiers.filter((i) => i.isPrimary)).toHaveLength(1)
      expect(d.device.primaryIdentifier).toBe(imeis[0])
    })

    it('finds the device by ANY of its identifiers', async () => {
      const imeis = [imei(30), imei(31), imei(32)]
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: imeis,
        mainType: 'USED',
        branchId: branchA,
      })
      for (const one of imeis) {
        expect(await findDeviceByIdentifier(actor, one), one).toBe(r.id)
      }
    })

    it('rejects a duplicate IMEI and names the conflicting device', async () => {
      const dup = imei(40)
      await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [dup],
        mainType: 'NEW',
        branchId: branchA,
      })
      await expect(
        createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [dup],
          mainType: 'USED',
          branchId: branchA,
        }),
      ).rejects.toThrow(/already belongs to Test Phone 5G/)
    })

    it('rejects a duplicate against a NON-primary identifier too', async () => {
      const secondary = imei(50)
      await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(51), secondary],
        mainType: 'USED',
        branchId: branchA,
      })
      await expect(
        createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [secondary],
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/already belongs/i)
    })

    it('validates IMEI shape and strips separators', () => {
      expect(normaliseIdentifiers(['3541-2312 3456789'])).toEqual(['354123123456789'])
      expect(() => normaliseIdentifiers(['ABC123'])).toThrow(/not a valid IMEI/)
      expect(() => normaliseIdentifiers(['123'])).toThrow(/not a valid IMEI/)
      expect(() => normaliseIdentifiers([])).toThrow(/At least one IMEI/)
      expect(() => normaliseIdentifiers(['35412312345678', '35412312345678'])).toThrow(/twice/)
    })
  })

  describe('device events — the basis of M9', () => {
    it('writes a PURCHASED event on creation', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(60)],
        mainType: 'NEW',
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.events).toHaveLength(1)
      expect(d.events[0]!.eventType).toBe('PURCHASED')
      expect(d.events[0]!.seq).toBe(1)
    })

    it('appends events in order and refuses to rewrite them', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(70)],
        mainType: 'USED',
        branchId: branchA,
      })
      await setDeviceStatus(
        { businessId, actorId: null },
        {
          deviceId: r.id,
          expectedStatus: 'IN_STOCK',
          nextStatus: 'RESERVED',
          eventType: 'RESERVED',
        },
      )
      const d = await getDevice(actor, r.id)
      expect(d.events.map((e) => e.seq)).toEqual([1, 2])
      expect(d.device.status).toBe('RESERVED')

      await expect(
        db.execute(`update device_event set seq = 99 where device_id = ${r.id}`),
      ).rejects.toThrow(/append-only/i)
      await expect(
        db.execute(`delete from device_event where device_id = ${r.id}`),
      ).rejects.toThrow(/append-only/i)
    })

    it('refuses an illegal status transition', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(80)],
        mainType: 'USED',
        branchId: branchA,
      })
      // A device in stock has not been sold, so it cannot be returned.
      await expect(
        setDeviceStatus(
          { businessId },
          {
            deviceId: r.id,
            expectedStatus: 'IN_STOCK',
            nextStatus: 'RETURNED',
            eventType: 'RETURNED',
          },
        ),
      ).rejects.toThrow(/cannot go from IN_STOCK to RETURNED/)
    })

    it('prevents two tills selling the same device', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(90)],
        mainType: 'USED',
        branchId: branchA,
      })
      const sell = () =>
        setDeviceStatus(
          { businessId },
          { deviceId: r.id, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
        )
      await expect(sell()).resolves.toBeUndefined()
      // The second attempt sees a device that is no longer IN_STOCK.
      await expect(sell()).rejects.toThrow(/no longer available/i)
    })

    it('models the returned-then-inspected path (FR-5.7)', () => {
      expect(canTransition('SOLD', 'RETURNED')).toBe(true)
      expect(canTransition('RETURNED', 'IN_STOCK')).toBe(true)
      expect(canTransition('RETURNED', 'DAMAGED')).toBe(true)
      expect(canTransition('RETURNED', 'SOLD')).toBe(false)
    })
  })

  describe('accessory stock — per branch', () => {
    it('keeps separate quantities per branch', async () => {
      const c = { businessId, refType: 'test' }
      await increaseStock(c, {
        productId: accessoryProductId,
        branchId: branchA,
        quantity: 10,
        movement: 'PURCHASE',
      })
      await increaseStock(c, {
        productId: accessoryProductId,
        branchId: branchB,
        quantity: 3,
        movement: 'PURCHASE',
      })
      expect((await getStock(accessoryProductId, branchA))!.quantity).toBe(10)
      expect((await getStock(accessoryProductId, branchB))!.quantity).toBe(3)
    })

    it('refuses to go negative rather than overselling', async () => {
      const c = { businessId }
      await expect(
        decreaseStock(c, {
          productId: accessoryProductId,
          branchId: branchB,
          quantity: 99,
          movement: 'SALE',
        }),
      ).rejects.toThrow(/Not enough stock/i)
      expect((await getStock(accessoryProductId, branchB))!.quantity).toBe(3)
    })

    it('writes an append-only ledger row for every movement', async () => {
      const before = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.productId, accessoryProductId))
        .orderBy(asc(schema.stockLedger.id))
      await decreaseStock(
        { businessId },
        { productId: accessoryProductId, branchId: branchA, quantity: 2, movement: 'SALE' },
      )
      const after = await db
        .select()
        .from(schema.stockLedger)
        .where(eq(schema.stockLedger.productId, accessoryProductId))
        // Without an explicit order Postgres may return heap order, and
        // at(-1) would then pick an arbitrary row rather than the newest.
        .orderBy(asc(schema.stockLedger.id))
      expect(after.length).toBe(before.length + 1)
      expect(after.at(-1)!.delta).toBe(-2)
      expect(after.at(-1)!.quantityAfter).toBe(8)

      await expect(
        db.execute(`update stock_ledger set delta = 0 where business_id = ${businessId}`),
      ).rejects.toThrow(/append-only/i)
    })

    it('reports low stock against the branch minimum', async () => {
      await setMinQuantity(actor, ctx, {
        productId: accessoryProductId,
        branchId: branchB,
        minQuantity: 5,
      })
      const low = await listLowStock(actor, branchB)
      expect(low.some((l) => l.productId === accessoryProductId)).toBe(true)
    })
  })

  describe('filtering — FR-4.6 and FR-5.4', () => {
    it('separates plain GLOBAL from GLOBAL + NEW CUT', async () => {
      const plain = await listDevices(actor, { globalVariant: 'PLAIN', page: 1, pageSize: 50 })
      const newCut = await listDevices(actor, { globalVariant: 'NEW_CUT', page: 1, pageSize: 50 })
      expect(plain.rows.every((r) => r.mainType === 'GLOBAL' && !r.isNewCut)).toBe(true)
      expect(newCut.rows.every((r) => r.mainType === 'GLOBAL' && r.isNewCut)).toBe(true)
      expect(newCut.total).toBeGreaterThan(0)
    })

    it('filters by each main type', async () => {
      for (const mainType of ['NEW', 'USED', 'ER', 'ACT', 'GLOBAL'] as const) {
        const { rows } = await listDevices(actor, { mainType, page: 1, pageSize: 50 })
        expect(rows.every((r) => r.mainType === mainType), mainType).toBe(true)
      }
    })

    it('summarises the five types with GLOBAL split by NEW CUT', async () => {
      const summary = await mainTypeSummary(actor, null)
      const global = summary.filter((s) => s.mainType === 'GLOBAL')
      expect(global.length).toBeGreaterThanOrEqual(1)
      expect(summary.some((s) => s.mainType === 'ER')).toBe(true)
    })

    it('hides purchase cost from a user without the permission', async () => {
      const staff = { ...actor, permissions: new Set<never>() } as unknown as AuthUser
      const { rows } = await listDevices(staff, { page: 1, pageSize: 5 })
      expect(rows.every((r) => r.purchasePricePaise === null)).toBe(true)
    })
  })

  describe('non-phone electronics — laptops, speakers (serial numbers)', () => {
    let laptopProductId: number
    let speakerProductId: number

    beforeAll(async () => {
      const laptops = await createCategory(actor, ctx, {
        name: 'Laptops',
        isSerialised: true,
        identifierType: 'SERIAL',
      })
      const speakers = await createCategory(actor, ctx, {
        name: 'Speakers',
        isSerialised: true,
        identifierType: 'SERIAL',
      })
      laptopProductId = (
        await createProduct(actor, ctx, { name: 'MacBook Air M3 256GB', categoryId: laptops.id })
      ).id
      speakerProductId = (
        await createProduct(actor, ctx, { name: 'Bose SoundLink', categoryId: speakers.id })
      ).id
    })

    it('accepts a MacBook serial number', async () => {
      const r = await createDevice(actor, ctx, {
        productId: laptopProductId,
        identifiers: [`C02${stamp % 100000}ABC`],
        mainType: 'NEW',
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.identifiers[0]!.type).toBe('SERIAL')
      expect(d.device.primaryIdentifier).toMatch(/^C02/)
    })

    it('applies the same classification to laptops as to phones', async () => {
      // The five main types are not mobile-only.
      for (const [i, mainType] of (['USED', 'ER', 'ACT', 'GLOBAL'] as const).entries()) {
        const r = await createDevice(actor, ctx, {
          productId: laptopProductId,
          identifiers: [`LAP-${stamp % 100000}-${i}`],
          mainType,
          branchId: branchA,
        })
        const d = await getDevice(actor, r.id)
        expect(d.device.mainType, mainType).toBe(mainType)
      }
    })

    it('still allows NEW CUT only under GLOBAL, laptop or not', async () => {
      await expect(
        createDevice(actor, ctx, {
          productId: laptopProductId,
          identifiers: [`LAPNC-${stamp % 100000}`],
          mainType: 'USED',
          isNewCut: true,
          branchId: branchA,
        }),
      ).rejects.toThrow(/only to GLOBAL/i)
    })

    it('rejects an IMEI-shaped value where a serial is expected, and vice versa', async () => {
      // A serial category will not take something that is clearly not a serial.
      await expect(
        createDevice(actor, ctx, {
          productId: speakerProductId,
          identifiers: ['ab'],
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/not a valid serial number/i)

      // A phone category will not take letters.
      await expect(
        createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: ['C02XY1234ABC'],
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/not a valid IMEI/i)
    })

    it('finds a laptop by its serial, the same way a phone is found by IMEI', async () => {
      const serial = `SPK-${stamp % 100000}-X`
      const r = await createDevice(actor, ctx, {
        productId: speakerProductId,
        identifiers: [serial],
        mainType: 'NEW',
        branchId: branchA,
      })
      expect(await findDeviceByIdentifier(actor, serial)).toBe(r.id)
    })

    it('gives a laptop the same append-only history as a phone', async () => {
      const r = await createDevice(actor, ctx, {
        productId: laptopProductId,
        identifiers: [`HIST-${stamp % 100000}`],
        mainType: 'USED',
        branchId: branchA,
      })
      await setDeviceStatus(
        { businessId },
        { deviceId: r.id, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
      )
      const d = await getDevice(actor, r.id)
      expect(d.events.map((e) => e.eventType)).toEqual(['PURCHASED', 'SOLD'])
    })

    it('refuses a duplicate serial across the whole business', async () => {
      const serial = `DUP-${stamp % 100000}-Z`
      await createDevice(actor, ctx, {
        productId: laptopProductId,
        identifiers: [serial],
        mainType: 'NEW',
        branchId: branchA,
      })
      await expect(
        createDevice(actor, ctx, {
          productId: speakerProductId,
          identifiers: [serial],
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/already belongs/i)
    })
  })

  describe('battery health', () => {
    it('records a reading on a used handset', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(300)],
        mainType: 'USED',
        batteryHealthPercent: 87,
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.device.batteryHealthPercent).toBe(87)
    })

    it('is optional — sealed new stock has no meaningful reading', async () => {
      const r = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(301)],
        mainType: 'NEW',
        branchId: branchA,
      })
      const d = await getDevice(actor, r.id)
      expect(d.device.batteryHealthPercent).toBeNull()
    })

    it('is available on laptops too, not just phones', async () => {
      const cat = await createCategory(actor, ctx, {
        name: 'Battery laptops',
        isSerialised: true,
        identifierType: 'SERIAL',
      })
      const { id: productId } = await createProduct(actor, ctx, {
        name: 'ThinkPad X1',
        categoryId: cat.id,
      })
      const r = await createDevice(actor, ctx, {
        productId,
        identifiers: [`BAT-${stamp % 100000}`],
        mainType: 'USED',
        batteryHealthPercent: 72,
        branchId: branchA,
      })
      expect((await getDevice(actor, r.id)).device.batteryHealthPercent).toBe(72)
    })

    it('refuses an impossible percentage at the DATABASE', async () => {
      // Bypassing the service, as an import or a script would.
      for (const bad of [0, 101, -5]) {
        await expect(
          db.insert(schema.deviceUnit).values({
            businessId,
            productId: mobileProductId,
            mainType: 'USED',
            batteryHealthPercent: bad,
          }),
          `battery ${bad}%`,
        ).rejects.toThrow(/battery_health_percent_range/i)
      }
    })
  })

  describe('stock counting — the shopkeeper question', () => {
    it('two identical handsets show as a stock of 2, not "tracked by IMEI"', async () => {
      const { listProducts, getProduct } = await import('@/server/services/product.service')
      const cat = await createCategory(actor, ctx, {
        name: 'Phones for counting',
        isSerialised: true,
        identifierType: 'IMEI',
      })
      const { id: productId } = await createProduct(actor, ctx, {
        name: 'iPhone 15 128GB',
        categoryId: cat.id,
      })

      // Two NEW units of the same variant, same branch.
      for (const n of [1, 2]) {
        await createDevice(actor, ctx, {
          productId,
          identifiers: [imei(200 + n)],
          mainType: 'NEW',
          colour: 'Black',
          branchId: branchA,
        })
      }

      const { rows } = await listProducts(actor, { search: 'iPhone 15 128GB', page: 1, pageSize: 10 })
      const row = rows.find((r) => r.id === productId)
      expect(row?.quantity, 'two handsets in stock should read as 2').toBe(2)

      // And a third at another branch is counted separately.
      await createDevice(actor, ctx, {
        productId,
        identifiers: [imei(203)],
        mainType: 'NEW',
        branchId: branchB,
      })
      const detail = await getProduct(actor, productId)
      const byBranch = Object.fromEntries(detail.stock.map((s) => [s.branchId, s.quantity]))
      expect(byBranch[branchA]).toBe(2)
      expect(byBranch[branchB]).toBe(1)

      // Selling one drops the count with no separate quantity to maintain.
      const sold = await listDevices(actor, { productId, branchId: branchA, page: 1, pageSize: 5 })
      await setDeviceStatus(
        { businessId },
        {
          deviceId: sold.rows[0]!.id,
          expectedStatus: 'IN_STOCK',
          nextStatus: 'SOLD',
          eventType: 'SOLD',
        },
      )
      const after = await listProducts(actor, {
        search: 'iPhone 15 128GB',
        page: 1,
        pageSize: 10,
      })
      expect(after.rows.find((r) => r.id === productId)?.quantity).toBe(2)
    })

    it('a counted accessory still reports its branch_stock total', async () => {
      const { listProducts } = await import('@/server/services/product.service')
      const { rows } = await listProducts(actor, { page: 1, pageSize: 100 })
      const cable = rows.find((r) => r.id === accessoryProductId)
      expect(cable?.isSerialised).toBe(false)
      expect(cable?.quantity).toBeGreaterThan(0)
    })
  })

  it('records device events without a status change too', async () => {
    const r = await createDevice(actor, ctx, {
      productId: mobileProductId,
      identifiers: [imei(95)],
      mainType: 'ACT',
      branchId: branchA,
    })
    await appendDeviceEvent(
      { businessId },
      { deviceId: r.id, eventType: 'INSPECTED', branchId: branchA, payload: { grade: 'A' } },
    )
    const d = await getDevice(actor, r.id)
    expect(d.events.at(-1)!.eventType).toBe('INSPECTED')
    expect(d.events.at(-1)!.payload).toMatchObject({ grade: 'A' })
  })
})
