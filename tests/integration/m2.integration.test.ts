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
import { updateBusiness } from '@/server/services/business.service'
import {
  appendDeviceEvent,
  canTransition,
  decreaseStock,
  defaultSalesChannel,
  getStock,
  increaseStock,
  setDeviceStatus,
} from '@/server/services/stock.service'
import { deviceTimeline, identifierLineage } from '@/server/services/device-history.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable, expectDatabaseRefusal, withAppendOnlySuspended } from './setup'

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
  /** Unique per run. Keep `n` under 100: runs are spaced by exactly that. */
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
      await expectDatabaseRefusal(
        db.insert(schema.deviceUnit).values({
          businessId,
          productId: mobileProductId,
          mainType: 'USED',
          isNewCut: true,
        }),
        /new_cut_only_global/i,
      )
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
      ).rejects.toThrow(/already in the shop on Test Phone 5G/)
    })

    /*
     * An IMEI is claimed by the device that HOLDS it, not forever.
     *
     * The old index was unique across all history, so a handset the shop sold
     * two years ago kept its number reserved for good and buying it back as a
     * trade-in was refused, naming a device that had not been in the shop
     * since. Two units in stock sharing a number is a real duplicate; a unit
     * that has left has no claim.
     */
    describe('an identifier is claimed by the device holding it', () => {
      it('lets a sold handset be bought back with the same IMEI', async () => {
        const traded = imei(500)
        const first = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [traded],
          mainType: 'NEW',
          branchId: branchA,
        })

        // It leaves the shop.
        await setDeviceStatus(
          { businessId, actorId: actor.id, refType: 'test', refId: first.id },
          { deviceId: first.id, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
        )

        // The same handset comes back in as a used trade-in. This used to fail.
        const second = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [traded],
          mainType: 'USED',
          branchId: branchA,
        })
        expect(second.id).not.toBe(first.id)

        // The number now points at the unit actually holding it...
        expect(await findDeviceByIdentifier(actor, traded)).toBe(second.id)
        // ...and the sold one kept its identifiers, so its warranty and
        // history still resolve.
        const old = await db
          .select()
          .from(schema.deviceIdentifier)
          .where(eq(schema.deviceIdentifier.deviceId, first.id))
        expect(old).toHaveLength(1)
        expect(old[0]!.releasedAt).not.toBeNull()
      })

      it('still refuses it while the first unit is in stock', async () => {
        const held = imei(501)
        await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [held],
          mainType: 'NEW',
          branchId: branchA,
        })
        await expect(
          createDevice(actor, ctx, {
            productId: mobileProductId,
            identifiers: [held],
            mainType: 'USED',
            branchId: branchA,
          }),
        ).rejects.toThrow(/already in the shop/i)
      })

      it('refuses it for a unit that is only reserved, not gone', async () => {
        const reserved = imei(502)
        const d = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [reserved],
          mainType: 'NEW',
          branchId: branchA,
        })
        await setDeviceStatus(
          { businessId, actorId: actor.id, refType: 'test', refId: d.id },
          {
            deviceId: d.id,
            expectedStatus: 'IN_STOCK',
            nextStatus: 'RESERVED',
            eventType: 'RESERVED',
          },
        )
        await expect(
          createDevice(actor, ctx, {
            productId: mobileProductId,
            identifiers: [reserved],
            mainType: 'USED',
            branchId: branchA,
          }),
        ).rejects.toThrow(/already in the shop/i)
      })

      it('takes the number back when a sold unit returns and nothing else holds it', async () => {
        const back = imei(503)
        const d = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [back],
          mainType: 'NEW',
          branchId: branchA,
        })
        const move = (expected: string, next: string, event: string) =>
          setDeviceStatus(
            { businessId, actorId: actor.id, refType: 'test', refId: d.id },
            {
              deviceId: d.id,
              expectedStatus: expected as never,
              nextStatus: next as never,
              eventType: event as never,
            },
          )
        await move('IN_STOCK', 'SOLD', 'SOLD')
        await move('SOLD', 'RETURNED', 'RETURNED')

        const rows = await db
          .select()
          .from(schema.deviceIdentifier)
          .where(eq(schema.deviceIdentifier.deviceId, d.id))
        expect(rows[0]!.releasedAt, 'back in hand, so the claim is back').toBeNull()
      })

      /*
       * The awkward one. A unit is sold, the shop buys another with the same
       * IMEI, and then the first sale is returned. Both are now in hand. The
       * returned unit cannot take the number back - the newer one holds it -
       * and the return must not fail because of that.
       */
      /*
       * Nobody thinks about a phone as "two device records". They think: we
       * bought it new, we sold it, we bought it back. So the lineage is the
       * events that happened to the NUMBER, flattened across every unit that
       * carried it - newest first, so where it stands today is the top line.
       */
      it('reads back as bought, sold, bought again', async () => {
        const reused = imei(505)
        const first = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [reused],
          mainType: 'NEW',
          branchId: branchA,
          purchaseDate: new Date('2026-01-05'),
        })
        await setDeviceStatus(
          { businessId, actorId: actor.id, refType: 'test', refId: first.id },
          { deviceId: first.id, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
        )
        const second = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [reused],
          mainType: 'USED',
          branchId: branchA,
          // Billed BEFORE the first unit, on purpose: ordering must follow
          // what was recorded, not what the supplier dated their bill.
          purchaseDate: new Date('2024-01-02'),
        })

        const lineage = await identifierLineage(actor, reused)

        // Two acquisitions. The sale is only an event here once a bill exists;
        // moving the status by hand leaves no sale to report, which is right -
        // this reads documents, it does not infer them.
        const acquisitions = lineage.filter((e) => e.kind === 'ACQUIRED')
        expect(acquisitions.map((e) => e.deviceId)).toEqual([second.id, first.id])
        expect(acquisitions.map((e) => e.pass)).toEqual([2, 1])

        // Newest first, so today's position is the top line.
        expect(lineage[0]!.kind).toBe('ACQUIRED')
        expect(lineage[0]!.deviceId).toBe(second.id)
        expect(lineage[0]!.holdsIdentifier).toBe(true)
        expect(lineage[0]!.inHand).toBe(true)

        // The oldest event is where it all started.
        expect(lineage.at(-1)!.deviceId).toBe(first.id)
        expect(lineage.at(-1)!.kind).toBe('ACQUIRED')
        expect(lineage.at(-1)!.pass).toBe(1)

        /*
         * Ordered on when things were actually recorded, not on bill dates.
         * A bill carries a date and no time, so two purchases on one day are
         * indistinguishable by `at` - and the buyback here is deliberately
         * billed months BEFORE the first unit, which date ordering would put
         * in the wrong place entirely.
         */
        const recorded = lineage.map((e) => e.recordedAt.getTime())
        expect(recorded).toEqual([...recorded].sort((a, b) => b - a))
        // Both are carried, so the page can show the bill date beside the time.
        expect(lineage.every((e) => e.at instanceof Date && e.recordedAt instanceof Date)).toBe(
          true,
        )

        // Each unit still keeps its own separate timeline.
        const firstTimeline = await deviceTimeline(actor, first.id)
        const secondTimeline = await deviceTimeline(actor, second.id)
        expect(firstTimeline.some((e) => e.eventType === 'SOLD')).toBe(true)
        expect(secondTimeline.some((e) => e.eventType === 'SOLD')).toBe(false)
        expect(firstTimeline[0]!.eventType).toBe('SOLD')
        expect(firstTimeline.at(-1)!.eventType).toBe('PURCHASED')
      })

      it('keeps every pass when the same handset cycles through repeatedly', async () => {
        const recurring = imei(507)
        const ids: number[] = []

        for (let pass = 0; pass < 4; pass++) {
          const unit = await createDevice(actor, ctx, {
            productId: mobileProductId,
            identifiers: [recurring],
            mainType: pass === 0 ? 'NEW' : 'USED',
            branchId: branchA,
            purchaseDate: new Date(Date.UTC(2024 + pass, 0, 1)),
          })
          ids.push(unit.id)
          if (pass < 3) {
            await setDeviceStatus(
              { businessId, actorId: actor.id, refType: 'test', refId: unit.id },
              {
                deviceId: unit.id,
                expectedStatus: 'IN_STOCK',
                nextStatus: 'SOLD',
                eventType: 'SOLD',
              },
            )
          }
        }

        const lineage = await identifierLineage(actor, recurring)
        const acquisitions = lineage.filter((e) => e.kind === 'ACQUIRED')
        // Every pass kept, newest first, numbered in the order they happened.
        expect(acquisitions).toHaveLength(4)
        expect(acquisitions.map((e) => e.deviceId)).toEqual([...ids].reverse())
        expect(acquisitions.map((e) => e.pass)).toEqual([4, 3, 2, 1])
        // However many passes, one holds the number: the one still in hand.
        expect(lineage.filter((e) => e.holdsIdentifier).map((e) => e.deviceId)).toEqual([ids[3]])
      })

      it('says nothing for an identifier only one unit has ever carried', async () => {
        const only = imei(506)
        await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [only],
          mainType: 'NEW',
          branchId: branchA,
        })
        // Nothing to tie together, and the unit's own timeline says it all.
        expect(await identifierLineage(actor, only)).toEqual([])
      })

      it('does not break a return when another unit has taken the number', async () => {
        const contested = imei(504)
        const first = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [contested],
          mainType: 'NEW',
          branchId: branchA,
        })
        await setDeviceStatus(
          { businessId, actorId: actor.id, refType: 'test', refId: first.id },
          { deviceId: first.id, expectedStatus: 'IN_STOCK', nextStatus: 'SOLD', eventType: 'SOLD' },
        )
        const second = await createDevice(actor, ctx, {
          productId: mobileProductId,
          identifiers: [contested],
          mainType: 'USED',
          branchId: branchA,
        })

        // The old sale comes back. It must not throw.
        await setDeviceStatus(
          { businessId, actorId: actor.id, refType: 'test', refId: first.id },
          {
            deviceId: first.id,
            expectedStatus: 'SOLD',
            nextStatus: 'RETURNED',
            eventType: 'RETURNED',
          },
        )

        // The newer unit keeps the claim; exactly one holder, as ever.
        const holders = await db
          .select()
          .from(schema.deviceIdentifier)
          .where(eq(schema.deviceIdentifier.value, contested))
        expect(holders.filter((r) => r.releasedAt === null)).toHaveLength(1)
        expect(holders.find((r) => r.releasedAt === null)!.deviceId).toBe(second.id)
      })
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
      ).rejects.toThrow(/already in the shop/i)
    })

    it('validates IMEI shape and strips separators', () => {
      expect(normaliseIdentifiers(['3541-2312 3456789'])).toEqual(['354123123456789'])
      expect(() => normaliseIdentifiers(['ABC123'])).toThrow(/not a valid IMEI/)
      expect(() => normaliseIdentifiers(['123'])).toThrow(/not a valid IMEI/)
      expect(() => normaliseIdentifiers([])).toThrow(/At least one IMEI/)
      expect(() => normaliseIdentifiers(['35412312345678', '35412312345678'])).toThrow(/twice/)
    })
  })

  /*
   * Reported by the shop: turning on "NEW stock is billed here" appeared to
   * do nothing. It did — for stock booked in afterwards. Each device carries
   * the channel it was created with and the till filters on that column, so
   * the handsets already on the shelf stayed hidden and the setting looked
   * broken.
   */
  describe('moving NEW stock between systems', () => {
    it('moves the handsets already in stock, not just future ones', async () => {
      const before = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(96)],
        mainType: 'NEW',
        branchId: branchA,
      })
      // Booked in while NEW stock belonged to the other system.
      expect((await getDevice(actor, before.id)).device.salesChannel).toBe('EXTERNAL')

      const result = await updateBusiness(actor, ctx, { newStockSalesChannel: 'ECITY' })
      expect(result.restamped).toBeGreaterThanOrEqual(1)
      expect((await getDevice(actor, before.id)).device.salesChannel).toBe('ECITY')
    })

    it('leaves a handset somebody had set by hand', async () => {
      // A per-device decision is not something a settings change should undo.
      const special = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(97)],
        mainType: 'NEW',
        branchId: branchA,
        salesChannel: 'BOTH',
      })

      await updateBusiness(actor, ctx, { newStockSalesChannel: 'EXTERNAL' })
      expect((await getDevice(actor, special.id)).device.salesChannel).toBe('BOTH')
    })

    it('never rewrites a handset that has already been sold', async () => {
      const sold = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(98)],
        mainType: 'NEW',
        branchId: branchA,
      })
      await updateBusiness(actor, ctx, { newStockSalesChannel: 'ECITY' })
      await setDeviceStatus(
        { businessId, actorId: 0, refType: 'test' },
        {
          deviceId: sold.id,
          expectedStatus: 'IN_STOCK',
          nextStatus: 'SOLD',
          eventType: 'SOLD',
        },
      )

      await updateBusiness(actor, ctx, { newStockSalesChannel: 'EXTERNAL' })
      // Where it was sold is history, and history is not edited by a setting.
      expect((await getDevice(actor, sold.id)).device.salesChannel).toBe('ECITY')
    })

    it('leaves used stock alone entirely', async () => {
      const used = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(99)],
        mainType: 'USED',
        branchId: branchA,
      })
      await updateBusiness(actor, ctx, { newStockSalesChannel: 'ECITY' })
      expect((await getDevice(actor, used.id)).device.salesChannel).toBe('ECITY')

      await updateBusiness(actor, ctx, { newStockSalesChannel: 'EXTERNAL' })
      // The setting is about NEW stock; used stock is always sold here.
      expect((await getDevice(actor, used.id)).device.salesChannel).toBe('ECITY')
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

      await expectDatabaseRefusal(
        db.execute(`update device_event set seq = 99 where device_id = ${r.id}`),
        /append-only/i,
      )
      await expectDatabaseRefusal(
        db.execute(`delete from device_event where device_id = ${r.id}`),
        /append-only/i,
      )
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

      await expectDatabaseRefusal(
        db.execute(`update stock_ledger set delta = 0 where business_id = ${businessId}`),
        /append-only/i,
      )
    })

    it('reports low stock against the branch minimum', async () => {
      await setMinQuantity(actor, ctx, {
        productId: accessoryProductId,
        branchId: branchB,
        minQuantity: 5,
      })
      const low = (await listLowStock(actor, branchB)).rows
      expect(low.some((l) => l.productId === accessoryProductId)).toBe(true)
    })

    /*
     * The low-stock list grows with the catalogue, not with the payroll, so it
     * pages and sorts in the database rather than being fetched whole.
     */
    it('pages, and reports the whole total rather than the page', async () => {
      const first = await listLowStock(actor, null, { page: 1, pageSize: 1 })
      expect(first.rows.length).toBeLessThanOrEqual(1)
      expect(first.total).toBeGreaterThanOrEqual(first.rows.length)
    })

    it('sorts by what is furthest below its minimum, worst first', async () => {
      const { rows } = await listLowStock(actor, null, { pageSize: 50 })
      const shortfalls = rows.map((r) => r.minQuantity - r.quantity)
      // Alphabetical order would bury what actually needs reordering.
      expect([...shortfalls].sort((a, b) => b - a)).toEqual(shortfalls)
    })

    it('sorts by product name when asked, and reverses', async () => {
      const up = await listLowStock(actor, null, { pageSize: 50, sort: 'product', dir: 'asc' })
      const down = await listLowStock(actor, null, { pageSize: 50, sort: 'product', dir: 'desc' })
      expect(down.rows.map((r) => r.productName)).toEqual(
        [...up.rows.map((r) => r.productName)].reverse(),
      )
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
      ).rejects.toThrow(/already in the shop/i)
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
        await expectDatabaseRefusal(
          db.insert(schema.deviceUnit).values({
            businessId,
            productId: mobileProductId,
            mainType: 'USED',
            batteryHealthPercent: bad,
          }),
          /battery_health_percent_range/i,
        )
      }
    })
  })

  describe('retiring a product from the catalogue', () => {
    /*
     * The only removal the catalogue has. A product that has been bought or
     * sold is referred to by that purchase, that bill and every stock movement
     * between them, so the row must stay; what has to stop is it being offered.
     *
     * `setProductActive` had existed since M2 with nothing calling it, so a
     * product created by mistake could not be got rid of at all - it had to be
     * deleted straight out of the database.
     */
    it('drops out of the catalogue and the pickers, and comes back', async () => {
      const { listProducts, setProductActive } = await import('@/server/services/product.service')
      const cat = await createCategory(actor, ctx, {
        name: 'Retirable accessories',
        isSerialised: false,
      })
      const { id: productId } = await createProduct(actor, ctx, {
        name: 'Discontinued Cable',
        categoryId: cat.id,
      })

      const visible = async (opts: { includeInactive?: boolean } = {}) => {
        const { rows } = await listProducts(actor, {
          search: 'Discontinued Cable',
          page: 1,
          pageSize: 10,
          ...opts,
        })
        return rows.some((r) => r.id === productId)
      }

      expect(await visible(), 'a new product is offered').toBe(true)

      await setProductActive(actor, ctx, productId, false)

      // Gone from the catalogue, and from the type-ahead the till and every
      // form read - /api/products/search goes through this same call with
      // includeInactive left off.
      expect(await visible(), 'a retired product is not offered').toBe(false)

      // But still there, and still findable, for the records that refer to it.
      expect(await visible({ includeInactive: true })).toBe(true)

      await setProductActive(actor, ctx, productId, true)
      expect(await visible(), 'and it can be brought back').toBe(true)
    })

    it('writes an audit entry naming the product, both ways', async () => {
      const { setProductActive } = await import('@/server/services/product.service')
      const cat = await createCategory(actor, ctx, {
        name: 'Audited accessories',
        isSerialised: false,
      })
      const { id: productId } = await createProduct(actor, ctx, {
        name: 'Audited Cable',
        categoryId: cat.id,
      })

      await setProductActive(actor, ctx, productId, false)
      await setProductActive(actor, ctx, productId, true)

      const rows = await db.execute<{ summary: string }>(
        `select summary from audit_log
          where entity_type = 'product' and entity_id = '${productId}'
          order by id`,
      )
      const summaries = (rows as unknown as { summary: string }[]).map((r) => r.summary)
      expect(summaries).toContain('Deactivated Audited Cable')
      expect(summaries).toContain('Reactivated Audited Cable')
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

  describe('who bills NEW stock (PRD OQ-11)', () => {
    async function setChannel(channel: 'EXTERNAL' | 'ECITY' | 'BOTH') {
      await db
        .update(schema.business)
        .set({ newStockSalesChannel: channel })
        .where(eq(schema.business.id, businessId))
    }

    it('defaults NEW stock to the other billing system', async () => {
      await setChannel('EXTERNAL')
      const { id } = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(400)],
        mainType: 'NEW',
        branchId: branchA,
      })
      expect((await getDevice(actor, id)).device.salesChannel).toBe('EXTERNAL')
    })

    it('lets a shop that sells new stock itself say so', async () => {
      await setChannel('ECITY')
      const { id } = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(401)],
        mainType: 'NEW',
        branchId: branchA,
      })
      // The whole point: this handset now reaches the till (FR-38.2).
      expect((await getDevice(actor, id)).device.salesChannel).toBe('ECITY')
    })

    it('supports stock billed in both systems', async () => {
      await setChannel('BOTH')
      const { id } = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(402)],
        mainType: 'NEW',
        branchId: branchA,
      })
      expect((await getDevice(actor, id)).device.salesChannel).toBe('BOTH')
    })

    it('never applies the setting to anything that is not NEW', async () => {
      await setChannel('EXTERNAL')
      const { id } = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(403)],
        mainType: 'USED',
        branchId: branchA,
      })
      // A used handset is always the shop's own to sell, whatever the setting.
      expect((await getDevice(actor, id)).device.salesChannel).toBe('ECITY')
      await setChannel('EXTERNAL')
    })
  })

  /*
   * A phone is identified by its IMEI. The serial printed on its box is a
   * different thing: useful for a warranty claim with the brand, often what a
   * customer quotes, and not always to hand when the stock is booked in. So
   * the category asks for it, the IMEI stays required, and the serial does not.
   */
  describe('a serial number beside the IMEI', () => {
    let dualProductId: number

    beforeAll(async () => {
      const cat = await createCategory(actor, ctx, {
        name: `Mobiles With Serial ${stamp}`,
        isSerialised: true,
        identifierType: 'IMEI',
        capturesSerial: true,
      })
      dualProductId = (
        await createProduct(actor, ctx, {
          name: `M2 DualId Phone ${stamp}`,
          categoryId: cat.id,
        })
      ).id
    })

    it('keeps both, each as its own identifier', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: dualProductId,
        identifiers: [imei(11)],
        serialNumber: `SN-${stamp}-A`,
        mainType: 'NEW',
        branchId: branchA,
      })

      const rows = await db
        .select({ value: schema.deviceIdentifier.value, type: schema.deviceIdentifier.type })
        .from(schema.deviceIdentifier)
        .where(eq(schema.deviceIdentifier.deviceId, id))

      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.type === 'IMEI')?.value).toBe(imei(11))
      expect(rows.find((r) => r.type === 'SERIAL')?.value).toBe(`SN-${stamp}-A`)
      // The IMEI is what names the handset; the serial is the extra.
      expect((await getDevice(actor, id)).device.primaryIdentifier).toBe(imei(11))
    })

    it('books the handset in without one', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: dualProductId,
        identifiers: [imei(12)],
        mainType: 'NEW',
        branchId: branchA,
      })
      const rows = await db
        .select({ type: schema.deviceIdentifier.type })
        .from(schema.deviceIdentifier)
        .where(eq(schema.deviceIdentifier.deviceId, id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.type).toBe('IMEI')
    })

    it('still refuses a device with no IMEI', async () => {
      await expect(
        createDevice(actor, ctx, {
          productId: dualProductId,
          identifiers: [],
          serialNumber: `SN-${stamp}-B`,
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/at least one imei/i)
    })

    it('will not let a serial collide with an identifier already in the shop', async () => {
      // The uniqueness index spans both kinds, so this has to be caught even
      // though one is a serial and the other an IMEI.
      await expect(
        createDevice(actor, ctx, {
          productId: dualProductId,
          identifiers: [imei(13)],
          serialNumber: imei(11),
          mainType: 'NEW',
          branchId: branchA,
        }),
      ).rejects.toThrow(/already in the shop/i)
    })

    it('ignores a serial offered for a category that does not ask for one', async () => {
      const { id } = await createDevice(actor, ctx, {
        productId: mobileProductId,
        identifiers: [imei(14)],
        serialNumber: `SN-${stamp}-C`,
        mainType: 'NEW',
        branchId: branchA,
      })
      const rows = await db
        .select({ type: schema.deviceIdentifier.type })
        .from(schema.deviceIdentifier)
        .where(eq(schema.deviceIdentifier.deviceId, id))
      // Stored nowhere rather than somewhere nothing would read it.
      expect(rows.every((r) => r.type === 'IMEI')).toBe(true)
    })
  })
})
