import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice } from '@/server/services/device.service'
import {
  businessExportSummary,
  streamBusinessExport,
} from '@/server/services/business-export.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M14 data protection (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let otherBusinessId: number
  let branchA: number
  let actor: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(41_100_000_000_000 + (stamp % 100_000) * 100 + n)

  async function readAll(response: Response): Promise<string> {
    return response.text()
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M14 Test ${stamp}` }).returning()
    )[0]!.id
    otherBusinessId = (
      await db.insert(schema.business).values({ name: `M14 Other ${stamp}` }).returning()
    )[0]!.id
    branchA = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `M14${stamp}`.slice(0, 12), name: 'M14 Branch' })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M14 Tester',
      email: 'm14@example.local',
      roleId: 0,
      permissions: new Set(['business.manage']),
      branchIds: [],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    const mobiles = await createCategory(actor, ctx, {
      name: 'M14 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const productId = (await createProduct(actor, ctx, { name: 'M14 Phone', categoryId: mobiles.id }))
      .id
    await createParty(actor, ctx, 'customer', { name: `M14 Buyer ${stamp}` })
    await createDevice(actor, ctx, {
      productId,
      identifiers: [imei(1)],
      mainType: 'USED',
      branchId: branchA,
    })

    // A second shop's customer, to prove the export never reaches it.
    await db
      .insert(schema.customer)
      .values({ businessId: otherBusinessId, name: `M14 NOT MINE ${stamp}` })
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      const ids = devices.map((d) => d.id)
      await db.delete(schema.exportJob).where(eq(schema.exportJob.businessId, businessId))
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db.execute(`delete from device_identifier where device_id in (${ids.join(',')})`)
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, otherBusinessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, otherBusinessId))
    })
  })

  describe('the owner’s own copy (FR-32.3)', () => {
    it('says what it will contain before it is taken', async () => {
      const summary = await businessExportSummary(actor)
      expect(summary.business).toContain('M14 Test')
      expect(summary.totalRows).toBeGreaterThan(0)

      const devices = summary.tables.find((t) => t.table === 'device_unit')
      expect(devices?.rows).toBe(1)
    })

    it('exports every table, naming each one', async () => {
      const text = await readAll(await streamBusinessExport(actor))

      for (const label of ['Business', 'Branches', 'Products', 'Customers', 'Devices']) {
        expect(text, `expected a ${label} section`).toContain(`## ${label} (`)
      }
      // The data itself, not a summary of it.
      expect(text).toContain(imei(1))
      expect(text).toContain(`M14 Buyer ${stamp}`)
    })

    /* The single worst bug this feature could have. */
    it('never contains another business’s rows', async () => {
      const text = await readAll(await streamBusinessExport(actor))
      expect(text).not.toContain('M14 NOT MINE')
      expect(text).not.toContain(`M14 Other ${stamp}`)
    })

    it('leaves password hashes and tokens out', async () => {
      const text = await readAll(await streamBusinessExport(actor))
      expect(text).not.toContain('password_hash')
      expect(text).not.toContain('reset_token')
    })

    it('opens as UTF-8 in a spreadsheet, and says it is not a system backup', async () => {
      /*
       * Checked as bytes, not as text: `Response.text()` strips a leading
       * byte-order mark by specification, so asserting on the decoded string
       * would report the mark missing while Excel receives it perfectly.
       */
      const bytes = new Uint8Array(await (await streamBusinessExport(actor)).arrayBuffer())
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

      const text = await readAll(await streamBusinessExport(actor))
      expect(text).toMatch(/not a system backup/i)
    })

    it('records that a full copy was taken, even if the download is abandoned', async () => {
      await streamBusinessExport(actor)
      const jobs = await db
        .select()
        .from(schema.exportJob)
        .where(eq(schema.exportJob.businessId, businessId))
      expect(jobs.some((j) => j.report === 'business-full-export')).toBe(true)
    })
  })
})
