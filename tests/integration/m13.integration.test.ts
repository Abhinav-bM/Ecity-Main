import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct, setMinQuantity } from '@/server/services/product.service'
import { createDevice } from '@/server/services/device.service'
import { increaseStock } from '@/server/services/stock.service'
import { createAdjustment } from '@/server/services/adjustment.service'
import {
  commitImport,
  createImportJob,
  validateImport,
} from '@/server/services/import.service'
import {
  ALL_KINDS,
  evaluateRules,
  listNotifications,
  listRules,
  markAllRead,
  markRead,
  setMuted,
  setRule,
  unreadCount,
  warrantyExpiring,
} from '@/server/services/notification.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M13 notifications, alerts and warranty (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let phoneProductId: number
  let cableProductId: number
  /** Sees everything, as an owner does. */
  let owner: AuthUser
  /** Scoped to branch A, and allowed to see money. */
  let branchManager: AuthUser
  /** Counter staff: stock only, no money screens. */
  let counter: AuthUser
  let ctx: AuditContext
  const imei = (n: number) => String(39_700_000_000_000 + (stamp % 100_000) * 100 + n)

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M13 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M13A${stamp}`.slice(0, 12), name: 'M13 Branch A' },
          { businessId, code: `M13B${stamp}`.slice(0, 12), name: 'M13 Branch B' },
        ])
        .returning()
    ).map((b) => b.id) as [number, number]

    owner = {
      id: 1,
      businessId,
      name: 'M13 Owner',
      email: 'm13owner@example.local',
      roleId: 0,
      permissions: new Set([
        'inventory.view',
        'customer_payment.view',
        'supplier_payment.view',
        'closing.view',
        'adjustment.view',
        'notification.view',
        'notification.manage',
      ]),
      branchIds: [],
      canViewAllBranches: true,
    }
    branchManager = {
      ...owner,
      id: 2,
      email: 'm13manager@example.local',
      branchIds: [branchA],
      canViewAllBranches: false,
    }
    counter = {
      ...owner,
      id: 3,
      email: 'm13staff@example.local',
      // Stock and adjustments, no money screens at all.
      permissions: new Set(['inventory.view', 'adjustment.view', 'notification.view']),
      branchIds: [branchA],
      canViewAllBranches: false,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    const mobiles = await createCategory(owner, ctx, {
      name: 'M13 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(owner, ctx, { name: 'M13 Cables', isSerialised: false })
    phoneProductId = (await createProduct(owner, ctx, { name: 'M13 Phone', categoryId: mobiles.id }))
      .id
    cableProductId = (await createProduct(owner, ctx, { name: 'M13 Cable', categoryId: cables.id }))
      .id
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      const ids = devices.map((d) => d.id)
      await db.execute(`delete from notification_read where notification_id in
        (select id from notification where business_id = ${businessId})`)
      await db.delete(schema.notification).where(eq(schema.notification.businessId, businessId))
      await db
        .delete(schema.notificationRule)
        .where(eq(schema.notificationRule.businessId, businessId))
      await clearMoney(businessId)
      await db.execute(`delete from stock_adjustment where business_id = ${businessId}`)
      await db.execute(`delete from import_row where job_id in
        (select id from import_job where business_id = ${businessId})`)
      await db.execute(`delete from import_job where business_id = ${businessId}`)
      await db.execute(`delete from supplier_ledger_entry where business_id = ${businessId}`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db
          .delete(schema.deviceIdentifier)
          .where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('raising, and not raising twice', () => {
    it('raises low stock once the shelf falls below its minimum', async () => {
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 2, movement: 'PURCHASE' },
      )
      await setMinQuantity(owner, ctx, {
        productId: cableProductId,
        branchId: branchA,
        minQuantity: 10,
      })

      const result = await evaluateRules(businessId)
      expect(result.LOW_STOCK.raised).toBe(1)

      const alerts = await listNotifications(owner)
      const low = alerts.find((a) => a.kind === 'LOW_STOCK')
      expect(low?.title).toMatch(/running low/i)
      expect(low?.body).toMatch(/minimum 10/)
      expect(low?.branchId).toBe(branchA)
    })

    /* The point of the dedupe key: a scheduled job must not shout hourly. */
    it('does not raise the same condition again on the next run', async () => {
      const again = await evaluateRules(businessId)
      expect(again.LOW_STOCK.raised).toBe(0)

      const alerts = await listNotifications(owner)
      expect(alerts.filter((a) => a.kind === 'LOW_STOCK')).toHaveLength(1)
    })

    it('closes the alert when the shelf is restocked, and can raise it again after', async () => {
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 50, movement: 'PURCHASE' },
      )
      const resolved = await evaluateRules(businessId)
      expect(resolved.LOW_STOCK.resolved).toBe(1)
      expect(await listNotifications(owner)).toHaveLength(0)

      /*
       * And the key does not block the next genuine occurrence — an alert
       * that could only ever fire once would be worse than none.
       */
      await db
        .update(schema.branchStock)
        .set({ quantity: 1 })
        .where(eq(schema.branchStock.productId, cableProductId))
      const raisedAgain = await evaluateRules(businessId)
      expect(raisedAgain.LOW_STOCK.raised).toBe(1)
    })
  })

  describe('who sees what (FR-27.2)', () => {
    beforeAll(async () => {
      // Something at branch B that branch A's manager must never see.
      // setMinQuantity creates the branch's stock row at zero, which is
      // already below any minimum.
      await setMinQuantity(owner, ctx, {
        productId: cableProductId,
        branchId: branchB,
        minQuantity: 5,
      })
      await evaluateRules(businessId)
    })

    it('the owner sees every branch', async () => {
      const alerts = await listNotifications(owner)
      const branches = new Set(alerts.map((a) => a.branchId))
      expect(branches.has(branchA)).toBe(true)
      expect(branches.has(branchB)).toBe(true)
    })

    it('a branch manager sees only their own', async () => {
      const alerts = await listNotifications(branchManager)
      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts.every((a) => a.branchId === branchA || a.branchId === null)).toBe(true)
    })

    it('hides a kind whose screen the person cannot open', async () => {
      /*
       * Counter staff have no money screens, so a supplier due is both noise
       * and a leak. The alert exists; they are simply not among its audience.
       */
      await db.insert(schema.notification).values({
        businessId,
        branchId: null,
        kind: 'SUPPLIER_DUE',
        title: 'Money owed',
        body: 'Test',
        dedupeKey: `SUPPLIER_DUE:test:${stamp}`,
      })

      const forOwner = await listNotifications(owner)
      const forCounter = await listNotifications(counter)
      expect(forOwner.some((a) => a.kind === 'SUPPLIER_DUE')).toBe(true)
      expect(forCounter.some((a) => a.kind === 'SUPPLIER_DUE')).toBe(false)
    })
  })

  describe('reading is personal', () => {
    it('one person clearing the bell does not clear it for anyone else', async () => {
      const before = await unreadCount(owner)
      expect(before).toBeGreaterThan(0)

      await markAllRead(owner)
      expect(await unreadCount(owner)).toBe(0)

      // The manager still has theirs — a till shortage must not be hidden
      // from the owner because a manager clicked something.
      expect(await unreadCount(branchManager)).toBeGreaterThan(0)
    })

    it('refuses to mark something the person cannot see', async () => {
      const supplierAlert = (await listNotifications(owner, { includeRead: true })).find(
        (a) => a.kind === 'SUPPLIER_DUE',
      )!
      const marked = await markRead(counter, [supplierAlert.id])
      expect(marked).toBe(0)
    })

    it('a read alert stays out of the list until asked for', async () => {
      const open = await listNotifications(owner)
      const all = await listNotifications(owner, { includeRead: true })
      expect(all.length).toBeGreaterThan(open.length)
    })
  })

  describe('rules and preferences', () => {
    it('lists every kind the person may see, with its default', async () => {
      const rules = await listRules(owner)
      expect(rules).toHaveLength(ALL_KINDS.length)
      expect(rules.find((r) => r.kind === 'WARRANTY_EXPIRY')?.thresholdDays).toBe(30)
    })

    it('turning a rule off for the shop clears what it had raised', async () => {
      await setRule(owner, 'LOW_STOCK', { isEnabled: false })
      const result = await evaluateRules(businessId)
      expect(result.LOW_STOCK.raised).toBe(0)
      expect(result.LOW_STOCK.resolved).toBeGreaterThan(0)

      const alerts = await listNotifications(owner)
      expect(alerts.some((a) => a.kind === 'LOW_STOCK')).toBe(false)

      await setRule(owner, 'LOW_STOCK', { isEnabled: true })
    })

    it('muting is mine alone and does not stop the alert existing', async () => {
      await setMuted(counter, 'LOW_STOCK', true)
      const mine = await listRules(counter)
      expect(mine.find((r) => r.kind === 'LOW_STOCK')?.mutedForMe).toBe(true)
      // The shop's setting is untouched.
      const shop = await listRules(owner)
      expect(shop.find((r) => r.kind === 'LOW_STOCK')?.mutedForMe).toBe(false)
      expect(shop.find((r) => r.kind === 'LOW_STOCK')?.isEnabled).toBe(true)
    })
  })

  /*
   * The M13 acceptance criterion: every one of the seven triggers fires on a
   * condition somebody constructed, and reaches the right people. Two of them
   * (low stock, warranty) have their own sections; these are the other five.
   *
   * The money and closing conditions are inserted directly rather than played
   * out through a week of trading: what is under test is the *rule*, and a
   * test that had to sell, part-pay and wait thirty days would be testing M4
   * and M5 again in the slowest possible way.
   */
  describe('the remaining triggers (FR-27.1)', () => {
    let customerId: number
    let supplierId: number

    beforeAll(async () => {
      customerId = (
        await db
          .insert(schema.customer)
          .values({ businessId, name: `M13 Debtor ${stamp}` })
          .returning()
      )[0]!.id
      supplierId = (
        await db
          .insert(schema.supplier)
          .values({ businessId, name: `M13 Creditor ${stamp}` })
          .returning()
      )[0]!.id
    })

    it('customer overdue: an unpaid bill past its due date', async () => {
      const longAgo = new Date()
      longAgo.setDate(longAgo.getDate() - 45)

      await db.insert(schema.sale).values({
        businessId,
        branchId: branchA,
        customerId,
        invoiceNumber: `M13-INV-${stamp}`,
        soldAt: longAgo,
        dueDate: longAgo,
        subtotalPaise: 500000n,
        totalPaise: 500000n,
        status: 'COMPLETED',
      })

      const result = await evaluateRules(businessId)
      expect(result.CUSTOMER_OVERDUE.raised).toBe(1)

      const alert = (await listNotifications(owner)).find((a) => a.kind === 'CUSTOMER_OVERDUE')
      expect(alert?.title).toMatch(/M13 Debtor/)
      expect(alert?.branchId).toBe(branchA)
    })

    it('supplier due: money owed, unpaid for too long', async () => {
      const longAgo = new Date()
      longAgo.setDate(longAgo.getDate() - 90)

      await db.insert(schema.supplierLedgerEntry).values({
        businessId,
        supplierId,
        entryType: 'PURCHASE',
        amountPaise: 250000n,
        occurredAt: longAgo,
      })

      const result = await evaluateRules(businessId)
      expect(result.SUPPLIER_DUE.raised).toBe(1)

      const alert = (await listNotifications(owner)).find(
        (a) => a.kind === 'SUPPLIER_DUE' && a.title.includes('M13 Creditor'),
      )
      // Owing a supplier is the business's problem, not one branch's.
      expect(alert?.branchId).toBeNull()
    })

    it('cash mismatch: a day closed with the till short', async () => {
      const day = new Date()
      day.setDate(day.getDate() - 2)
      const businessDate = day.toISOString().slice(0, 10)

      await db.insert(schema.dailyClosing).values({
        businessId,
        branchId: branchA,
        businessDate,
        expectedCashPaise: 100000n,
        countedCashPaise: 85000n,
        cashDifferencePaise: -15000n,
      })

      const result = await evaluateRules(businessId)
      expect(result.CASH_MISMATCH.raised).toBe(1)

      const alert = (await listNotifications(owner)).find((a) => a.kind === 'CASH_MISMATCH')
      expect(alert?.title).toMatch(/short/i)
      // A till that does not balance is never merely informational.
      expect(alert?.severity).toBe('CRITICAL')
    })

    it('unclosed day: a branch took money and nobody counted the till', async () => {
      const day = new Date()
      day.setDate(day.getDate() - 3)
      const businessDate = day.toISOString().slice(0, 10)

      const drawer = (
        await db
          .insert(schema.cashDrawerDay)
          .values({ businessId, branchId: branchB, businessDate, openingPaise: 0n })
          .returning()
      )[0]!

      await db.insert(schema.cashMovement).values({
        businessId,
        drawerDayId: drawer.id,
        branchId: branchB,
        movement: 'SALE',
        amountPaise: 50000n,
        refType: 'test',
      })

      const result = await evaluateRules(businessId)
      expect(result.UNCLOSED_DAY.raised).toBe(1)

      const alert = (await listNotifications(owner)).find((a) => a.kind === 'UNCLOSED_DAY')
      expect(alert?.title).toContain(businessDate)
      expect(alert?.branchId).toBe(branchB)
    })

    it('stock adjustment: stock corrected outside the ordinary path', async () => {
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 10, movement: 'PURCHASE' },
      )
      await createAdjustment(owner, ctx, {
        branchId: branchA,
        productId: cableProductId,
        reason: 'MISCOUNT',
        quantityDelta: -3,
        notes: 'Three missing from the shelf',
      })

      const result = await evaluateRules(businessId)
      expect(result.STOCK_ADJUSTMENT.raised).toBe(1)

      const alert = (await listNotifications(owner)).find((a) => a.kind === 'STOCK_ADJUSTMENT')
      expect(alert?.body).toMatch(/miscount/i)
      expect(alert?.body).toContain('Three missing')
    })

    it('reaches exactly the right people', async () => {
      /*
       * The acceptance criterion's second half. The counter can see stock
       * things at their own branch and nothing about money; the owner sees
       * all of it, including the other branch's unclosed day.
       */
      const forCounter = await listNotifications(counter, { includeRead: true })
      const kinds = new Set(forCounter.map((a) => a.kind))
      expect(kinds.has('STOCK_ADJUSTMENT')).toBe(true)
      expect(kinds.has('CUSTOMER_OVERDUE')).toBe(false)
      expect(kinds.has('CASH_MISMATCH')).toBe(false)
      expect(kinds.has('SUPPLIER_DUE')).toBe(false)
      expect(forCounter.every((a) => a.branchId === branchA || a.branchId === null)).toBe(true)

      const forOwner = await listNotifications(owner, { includeRead: true })
      const ownerKinds = new Set(forOwner.map((a) => a.kind))
      for (const kind of [
        'LOW_STOCK',
        'CUSTOMER_OVERDUE',
        'SUPPLIER_DUE',
        'CASH_MISMATCH',
        'UNCLOSED_DAY',
        'STOCK_ADJUSTMENT',
      ]) {
        expect(ownerKinds.has(kind as never), `owner should see ${kind}`).toBe(true)
      }
    })

    it('a branch manager is not told about the other branch\'s unclosed day', async () => {
      const forManager = await listNotifications(branchManager, { includeRead: true })
      expect(forManager.some((a) => a.kind === 'UNCLOSED_DAY')).toBe(false)
    })
  })

  describe('warranty (FR-29)', () => {
    /*
     * A shop migrating its stock at go-live has warranties running on it
     * (docs/04 §10). Losing them on import would lose them on exactly the
     * handsets nobody can re-derive the cover for.
     */
    it('comes in from a file, with its provider', async () => {
      const staged = await createImportJob(owner, ctx, {
        kind: 'DEVICES',
        fileName: 'stock.csv',
        content:
          'Product,IMEI No,Type,Warranty,Warranty By\n' +
          `M13 Phone,${imei(9)},USED,18,Brand India\n`,
        branchId: branchA,
      })
      expect(staged.suggested).toMatchObject({
        warrantyMonths: 'Warranty',
        warrantyProvider: 'Warranty By',
      })

      await validateImport(owner, staged.id, staged.suggested)
      const result = await commitImport(owner, ctx, staged.id)
      expect(result.committed).toBe(1)

      const device = (
        await db
          .select()
          .from(schema.deviceUnit)
          .where(eq(schema.deviceUnit.primaryIdentifier, imei(9)))
      )[0]!
      expect(device.warrantyMonths).toBe(18)
      expect(device.warrantyProvider).toBe('Brand India')
    })

    it('lists a handset whose cover runs out soon, with who honours it', async () => {
      const soon = new Date()
      soon.setDate(soon.getDate() + 10)

      const device = await createDevice(owner, ctx, {
        productId: phoneProductId,
        identifiers: [imei(1)],
        mainType: 'USED',
        branchId: branchA,
        purchaseDate: new Date(),
        warrantyMonths: 12,
        warrantyProvider: 'Brand India',
      })
      // Pull the expiry close, as though it were bought a year ago.
      await db
        .update(schema.deviceUnit)
        .set({ warrantyExpiresAt: soon })
        .where(eq(schema.deviceUnit.id, device.id))

      const { rows } = await warrantyExpiring(owner, { withinDays: 30 })
      const row = rows.find((r) => r.id === device.id)
      expect(row?.provider).toBe('Brand India')
      expect(row?.daysLeft).toBeGreaterThanOrEqual(9)
      expect(row?.daysLeft).toBeLessThanOrEqual(10)
    })

    it('raises an alert for it, and says which handset', async () => {
      const result = await evaluateRules(businessId)
      expect(result.WARRANTY_EXPIRY.raised).toBe(1)

      const alert = (await listNotifications(owner)).find((a) => a.kind === 'WARRANTY_EXPIRY')
      expect(alert?.body).toContain(imei(1))
    })

    /* FR-29.1 names the customer among what warranty tracking must carry. */
    it('names who owns a sold handset, and says so plainly when nobody does', async () => {
      const device = await createDevice(owner, ctx, {
        productId: phoneProductId,
        identifiers: [imei(2)],
        mainType: 'USED',
        branchId: branchA,
        warrantyMonths: 12,
      })
      const soon = new Date()
      soon.setDate(soon.getDate() + 20)
      await db
        .update(schema.deviceUnit)
        .set({ warrantyExpiresAt: soon })
        .where(eq(schema.deviceUnit.id, device.id))

      // While it is on the shelf, nobody owns it.
      const onShelf = (await warrantyExpiring(owner, { withinDays: 30 })).rows.find(
        (r) => r.id === device.id,
      )
      expect(onShelf?.customerId).toBeNull()
      expect(onShelf?.saleId).toBeNull()

      // Sell it, and the list can answer "whose is it?".
      const buyer = (
        await db
          .insert(schema.customer)
          .values({ businessId, name: `M13 Owner Of ${stamp}` })
          .returning()
      )[0]!
      const sale = (
        await db
          .insert(schema.sale)
          .values({
            businessId,
            branchId: branchA,
            customerId: buyer.id,
            invoiceNumber: `M13-WAR-${stamp}`,
            soldAt: new Date(),
            subtotalPaise: 100000n,
            totalPaise: 100000n,
            status: 'COMPLETED',
          })
          .returning()
      )[0]!
      await db.insert(schema.saleItem).values({
        saleId: sale.id,
        productId: phoneProductId,
        deviceId: device.id,
        quantity: 1,
        unitPricePaise: 100000n,
        lineTotalPaise: 100000n,
        taxablePaise: 100000n,
      })

      const sold = (await warrantyExpiring(owner, { withinDays: 30 })).rows.find(
        (r) => r.id === device.id,
      )
      expect(sold?.customerName).toBe(`M13 Owner Of ${stamp}`)
      expect(sold?.invoiceNumber).toBe(`M13-WAR-${stamp}`)
    })

    it('a branch manager does not see another branch', async () => {
      const rows = await warrantyExpiring(branchManager, { withinDays: 30 })
      expect(rows.rows.every((r) => r.branchName === 'M13 Branch A')).toBe(true)
    })

    /*
     * The purchase screen asks for the day cover ends rather than a period: a
     * used handset is sold with "covered until the 14th", and a period only
     * answers that after arithmetic against a start date the buyer never saw.
     */
    it('takes an explicit end date, and lets it beat a period', async () => {
      const until = new Date()
      until.setDate(until.getDate() + 20)
      until.setHours(0, 0, 0, 0)

      const device = await createDevice(owner, ctx, {
        productId: phoneProductId,
        identifiers: [imei(31)],
        mainType: 'USED',
        branchId: branchA,
        purchaseDate: new Date(),
        // Both supplied: 12 months would land a year out, the date is 20 days.
        warrantyMonths: 12,
        warrantyUntil: until,
        warrantyProvider: 'Shop',
      })

      const row = (
        await db
          .select()
          .from(schema.deviceUnit)
          .where(eq(schema.deviceUnit.id, device.id))
      )[0]!
      expect(row.warrantyExpiresAt?.toISOString().slice(0, 10)).toBe(
        until.toISOString().slice(0, 10),
      )
      // The period is still kept as it was given; the date is what governs.
      expect(row.warrantyMonths).toBe(12)

      const { rows } = await warrantyExpiring(owner, { withinDays: 30 })
      expect(rows.some((r) => r.id === device.id)).toBe(true)
    })

    it('refuses a warranty that ends on or before the day of purchase', async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const make = (warrantyUntil: Date) =>
        createDevice(owner, ctx, {
          productId: phoneProductId,
          identifiers: [imei(40 + warrantyUntil.getDate())],
          mainType: 'USED',
          branchId: branchA,
          purchaseDate: today,
          warrantyUntil,
        })

      // The case the shopkeeper actually hits: a used handset bought today,
      // with cover typed as today. That is a typo, not a one-day warranty.
      await expect(make(today)).rejects.toThrow(/end after the day the goods were bought/i)

      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      await expect(make(yesterday)).rejects.toThrow(/end after the day/i)
    })

    /*
     * Anchored to the purchase date, not to today - or a shop booking in last
     * week's delivery, or migrating old stock at go-live, could not record a
     * warranty that has genuinely already lapsed.
     */
    it('still accepts a lapsed warranty on a backdated purchase', async () => {
      const boughtLongAgo = new Date()
      boughtLongAgo.setDate(boughtLongAgo.getDate() - 400)
      const coverEnded = new Date()
      coverEnded.setDate(coverEnded.getDate() - 35)

      const device = await createDevice(owner, ctx, {
        productId: phoneProductId,
        identifiers: [imei(45)],
        mainType: 'USED',
        branchId: branchA,
        purchaseDate: boughtLongAgo,
        warrantyUntil: coverEnded,
      })

      const row = (
        await db.select().from(schema.deviceUnit).where(eq(schema.deviceUnit.id, device.id))
      )[0]!
      expect(row.warrantyExpiresAt?.toISOString().slice(0, 10)).toBe(
        coverEnded.toISOString().slice(0, 10),
      )
    })

    /*
     * There was no lower bound at all, so a handset whose cover lapsed years
     * ago sat in "expiring within 60 days" for ever and buried the few pieces
     * actually running out.
     */
    it('drops a warranty that lapsed long ago, but keeps a recent one', async () => {
      const longGone = new Date()
      longGone.setDate(longGone.getDate() - 400)
      const justGone = new Date()
      justGone.setDate(justGone.getDate() - 5)

      const make = async (n: number, expiresAt: Date) => {
        const d = await createDevice(owner, ctx, {
          productId: phoneProductId,
          identifiers: [imei(n)],
          mainType: 'USED',
          branchId: branchA,
        })
        await db
          .update(schema.deviceUnit)
          .set({ warrantyExpiresAt: expiresAt })
          .where(eq(schema.deviceUnit.id, d.id))
        return d.id
      }

      const ancient = await make(32, longGone)
      const recent = await make(33, justGone)

      const { rows } = await warrantyExpiring(owner, { withinDays: 30 })
      expect(rows.some((r) => r.id === recent), 'lapsed 5 days ago is still news').toBe(true)
      expect(rows.some((r) => r.id === ancient), 'lapsed 400 days ago is not').toBe(false)

      /*
       * A wider window does reach it. The screen offers up to a year, so a
       * warranty that lapsed more than a year ago is off this list for good -
       * which is the point: it is not something anyone can still act on. The
       * date itself is not lost, it is on the handset's own page.
       */
      const veryWide = await warrantyExpiring(owner, { withinDays: 500 })
      expect(veryWide.rows.some((r) => r.id === ancient)).toBe(true)
    })
  })
})
