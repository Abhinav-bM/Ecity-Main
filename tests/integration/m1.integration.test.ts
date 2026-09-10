import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createParty, listParties, setPartyStatus, updateParty } from '@/server/services/party.service'
import {
  assertBranchAcceptsTransactions,
  createBranch,
  listAccessibleBranches,
  setBranchStatus,
} from '@/server/services/branch.service'
import {
  setPaymentMethodActive,
  upsertPaymentMethod,
  upsertTaxRate,
} from '@/server/services/business.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { databaseAvailable } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M1 master data (database-backed)', () => {
  let businessId: number
  let actor: AuthUser
  let ctx: AuditContext
  const stamp = Date.now()

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M1 Test ${stamp}` }).returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M1 Tester',
      email: 'm1@example.local',
      roleId: 0,
      permissions: new Set(),
      branchIds: [],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId }
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
    await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
    await db.delete(schema.taxRate).where(eq(schema.taxRate.businessId, businessId))
    await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
    await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
    await db.delete(schema.business).where(eq(schema.business.id, businessId))
  })

  describe('branches', () => {
    it('creates a branch and normalises its code', async () => {
      const { id } = await createBranch(actor, ctx, { code: `a${stamp}`, name: 'Alpha Branch' })
      const row = (await db.select().from(schema.branch).where(eq(schema.branch.id, id)))[0]!
      expect(row.code).toBe(`A${stamp}`.toUpperCase())
      expect(row.status).toBe('ACTIVE')
    })

    it('refuses a duplicate branch code', async () => {
      await createBranch(actor, ctx, { code: `dup${stamp}`, name: 'First' })
      await expect(
        createBranch(actor, ctx, { code: `dup${stamp}`, name: 'Second' }),
      ).rejects.toThrow(/already in use/i)
    })

    it('deactivating hides the branch from pickers but keeps the record', async () => {
      const { id } = await createBranch(actor, ctx, { code: `off${stamp}`, name: 'Closing Soon' })
      await setBranchStatus(actor, ctx, id, 'INACTIVE')

      const visible = await listAccessibleBranches({ ...actor, branchIds: [id] })
      expect(visible.map((b) => b.id)).not.toContain(id)

      const row = (await db.select().from(schema.branch).where(eq(schema.branch.id, id)))[0]
      expect(row, 'the branch row must survive deactivation').toBeTruthy()
      expect(row!.status).toBe('INACTIVE')
    })

    it('blocks new transactions against a deactivated branch (FR-3.8)', async () => {
      const { id } = await createBranch(actor, ctx, { code: `blk${stamp}`, name: 'Blocked' })
      await expect(assertBranchAcceptsTransactions(actor, id)).resolves.toBeTruthy()
      await setBranchStatus(actor, ctx, id, 'INACTIVE')
      await expect(assertBranchAcceptsTransactions(actor, id)).rejects.toThrow(/deactivated/i)
    })

    it('refuses to deactivate the last active branch', async () => {
      const solo = (
        await db
          .insert(schema.business)
          .values({ name: `Solo ${stamp}` })
          .returning()
      )[0]!
      const soloActor = { ...actor, businessId: solo.id }
      const soloCtx = { ...ctx, businessId: solo.id }
      const { id } = await createBranch(soloActor, soloCtx, { code: 'ONLY', name: 'Only Branch' })

      await expect(setBranchStatus(soloActor, soloCtx, id, 'INACTIVE')).rejects.toThrow(
        /at least one branch/i,
      )

      await db.delete(schema.branch).where(eq(schema.branch.businessId, solo.id))
      await db.delete(schema.business).where(eq(schema.business.id, solo.id))
    })
  })

  describe('customers and suppliers', () => {
    it('stores empty optional fields as null, not empty strings', async () => {
      const { id } = await createParty(actor, ctx, 'customer', {
        name: 'Walk-in Customer',
        phone: '',
        email: '',
      })
      const row = (await db.select().from(schema.customer).where(eq(schema.customer.id, id)))[0]!
      expect(row.phone).toBeNull()
      expect(row.email).toBeNull()
    })

    it('normalises email to lower case and GSTIN to upper case', async () => {
      const { id } = await createParty(actor, ctx, 'customer', {
        name: 'Case Test',
        email: '  MiXeD@Example.COM ',
        gstin: '29abcde1234f1z5',
      })
      const row = (await db.select().from(schema.customer).where(eq(schema.customer.id, id)))[0]!
      expect(row.email).toBe('mixed@example.com')
      expect(row.gstin).toBe('29ABCDE1234F1Z5')
    })

    it('refuses a second customer with the same phone', async () => {
      const phone = `9${stamp}`.slice(0, 10)
      await createParty(actor, ctx, 'customer', { name: 'First Person', phone })
      await expect(
        createParty(actor, ctx, 'customer', { name: 'Second Person', phone }),
      ).rejects.toThrow(/already uses this phone/i)
    })

    it('allows a customer and a supplier to share a phone', async () => {
      const phone = `8${stamp}`.slice(0, 10)
      await createParty(actor, ctx, 'customer', { name: 'Shared Phone Cust', phone })
      await expect(
        createParty(actor, ctx, 'supplier', { name: 'Shared Phone Supp', phone }),
      ).resolves.toBeTruthy()
    })

    it('lets a record keep its own phone when edited', async () => {
      const phone = `7${stamp}`.slice(0, 10)
      const { id } = await createParty(actor, ctx, 'supplier', { name: 'Edit Me', phone })
      await expect(
        updateParty(actor, ctx, 'supplier', id, { name: 'Edited Name', phone }),
      ).resolves.toBeUndefined()
    })

    it('searches by name, phone and email', async () => {
      await createParty(actor, ctx, 'customer', {
        name: 'Searchable Person',
        phone: `6${stamp}`.slice(0, 10),
        email: `findme${stamp}@example.local`,
      })
      for (const term of ['Searchable', `findme${stamp}`]) {
        const { rows } = await listParties(actor, 'customer', {
          search: term,
          page: 1,
          pageSize: 25,
        })
        expect(rows.length, `search "${term}"`).toBeGreaterThan(0)
      }
    })

    it('hides deactivated parties by default but keeps them findable', async () => {
      const { id } = await createParty(actor, ctx, 'supplier', { name: `Gone Supplier ${stamp}` })
      await setPartyStatus(actor, ctx, 'supplier', id, 'INACTIVE')

      const active = await listParties(actor, 'supplier', {
        search: `Gone Supplier ${stamp}`,
        page: 1,
        pageSize: 25,
      })
      expect(active.rows).toHaveLength(0)

      const all = await listParties(actor, 'supplier', {
        search: `Gone Supplier ${stamp}`,
        includeInactive: true,
        page: 1,
        pageSize: 25,
      })
      expect(all.rows).toHaveLength(1)
    })
  })

  describe('tax and payment settings', () => {
    it('stores rates as integer basis points', async () => {
      const { id } = await upsertTaxRate(actor, ctx, {
        name: 'GST 18% test',
        rateBasisPoints: 1800,
      })
      const row = (await db.select().from(schema.taxRate).where(eq(schema.taxRate.id, id)))[0]!
      expect(row.rateBasisPoints).toBe(1800)
      expect(Number.isInteger(row.rateBasisPoints)).toBe(true)
    })

    it('rejects an impossible rate', async () => {
      await expect(
        upsertTaxRate(actor, ctx, { name: 'Bad', rateBasisPoints: 20000 }),
      ).rejects.toThrow(/between 0% and 100%/i)
    })

    it('keeps only one default rate', async () => {
      await upsertTaxRate(actor, ctx, { name: 'D1', rateBasisPoints: 500, isDefault: true })
      await upsertTaxRate(actor, ctx, { name: 'D2', rateBasisPoints: 1200, isDefault: true })
      const defaults = await db
        .select()
        .from(schema.taxRate)
        .where(eq(schema.taxRate.businessId, businessId))
      expect(defaults.filter((r) => r.isDefault)).toHaveLength(1)
    })

    /*
     * The add form asks for a name and a kind, not a code. `code` is unique
     * per business and shown in the list, but nothing in the app branches on
     * it - so making a shop owner invent one was asking them to do the
     * database's filing. It is derived here instead.
     */
    it('derives a payment method code from its name', async () => {
      const { id } = await upsertPaymentMethod(actor, ctx, {
        name: 'Google Pay',
        type: 'UPI',
      })
      const row = (
        await db.select().from(schema.paymentMethod).where(eq(schema.paymentMethod.id, id)).limit(1)
      )[0]!
      expect(row.code).toBe('GOOGLE_PAY')
      // UPI does not reach the till drawer unless it is asked to.
      expect(row.affectsCashDrawer).toBe(false)
    })

    it('sidesteps a code another method already has', async () => {
      const first = await upsertPaymentMethod(actor, ctx, { name: 'Paytm', type: 'UPI' })
      const second = await upsertPaymentMethod(actor, ctx, { name: 'Paytm', type: 'UPI' })
      const rows = await db
        .select()
        .from(schema.paymentMethod)
        .where(inArray(schema.paymentMethod.id, [first.id, second.id]))
      expect(rows.map((r) => r.code).sort()).toEqual(['PAYTM', 'PAYTM_2'])
    })

    it('leaves the code alone when the method is renamed', async () => {
      const { id } = await upsertPaymentMethod(actor, ctx, { name: 'Card', type: 'CARD' })
      await upsertPaymentMethod(actor, ctx, { id, name: 'Card machine', type: 'CARD' })
      const row = (
        await db.select().from(schema.paymentMethod).where(eq(schema.paymentMethod.id, id)).limit(1)
      )[0]!
      expect(row.code).toBe('CARD')
      expect(row.name).toBe('Card machine')
    })

    it('refuses to deactivate the only cash payment method', async () => {
      const cash = (
        await db
          .insert(schema.paymentMethod)
          .values({ businessId, code: 'CASH', name: 'Cash', type: 'CASH' })
          .returning()
      )[0]!
      await expect(setPaymentMethodActive(actor, ctx, cash.id, false)).rejects.toThrow(
        /cash payment method/i,
      )
    })
  })

  it('audits everything it did', async () => {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.businessId, businessId))
    const entities = new Set(rows.map((r) => r.entityType))
    expect(entities).toContain('branch')
    expect(entities).toContain('customer')
    expect(entities).toContain('supplier')
    expect(entities).toContain('tax_rate')
  })
})
