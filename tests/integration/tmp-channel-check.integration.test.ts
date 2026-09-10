import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createDevice } from '@/server/services/device.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

/** Throwaway probe: what channel does a NEW *serial* device land on? */
suite('probe: sales channel for serial-tracked devices', () => {
  const stamp = Date.now()
  let businessId: number
  let branchId: number
  let actor: AuthUser
  let ctx: AuditContext

  beforeAll(async () => {
    businessId = (
      await db
        .insert(schema.business)
        .values({ name: `Probe ${stamp}`, newStockSalesChannel: 'EXTERNAL' })
        .returning()
    )[0]!.id
    branchId = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `PR${stamp}`.slice(0, 12), name: 'Probe Branch' })
        .returning()
    )[0]!.id
    actor = {
      id: 0,
      businessId,
      name: 'Probe',
      email: 'probe@example.local',
      roleId: 0,
      permissions: new Set(),
      branchIds: [branchId],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId }
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
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
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  it('reports the channel a NEW laptop and a NEW phone each get', async () => {
    const laptops = await createCategory(actor, ctx, {
      name: 'Probe Laptops',
      isSerialised: true,
      identifierType: 'SERIAL',
    })
    const phones = await createCategory(actor, ctx, {
      name: 'Probe Phones',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const laptop = await createProduct(actor, ctx, {
      name: 'Probe MacBook',
      categoryId: laptops.id,
    })
    const phone = await createProduct(actor, ctx, { name: 'Probe Phone', categoryId: phones.id })

    const l = await createDevice(actor, ctx, {
      productId: laptop.id,
      identifiers: [`C02PROBE${String(stamp).slice(-6)}`],
      mainType: 'NEW',
      branchId,
    })
    const p = await createDevice(actor, ctx, {
      productId: phone.id,
      identifiers: [String(35_900_000_000_000 + (stamp % 1_000_000))],
      mainType: 'NEW',
      branchId,
    })

    const channelOf = async (id: number) =>
      (
        await db
          .select({ c: schema.deviceUnit.salesChannel })
          .from(schema.deviceUnit)
          .where(eq(schema.deviceUnit.id, id))
      )[0]!.c

    const laptopChannel = await channelOf(l.id)
    const phoneChannel = await channelOf(p.id)

    // eslint-disable-next-line no-console
    console.log(`\n>>> NEW laptop channel = ${laptopChannel}`)
    // eslint-disable-next-line no-console
    console.log(`>>> NEW phone  channel = ${phoneChannel}\n`)

    expect({ laptopChannel, phoneChannel }).toBeTruthy()
  })
})
