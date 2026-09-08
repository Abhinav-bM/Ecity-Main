import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct, createBrand } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { createDevice } from '@/server/services/device.service'
import { increaseStock } from '@/server/services/stock.service'
import { createSale } from '@/server/services/sale.service'
import { createExpense } from '@/server/services/expense.service'
import {
  brandPerformance,
  byMainType,
  customerAnalytics,
  growthBasisPoints,
  inventoryMovement,
  paymentMix,
  previousRange,
  productPerformance,
  profitSummary,
  salesByBranch,
  purchaseTotals,
  salesTotals,
  stockAlerts,
  stockByMainType,
  stockOnHand,
  stockTurnover,
  bestDays,
  collectionPerformance,
  insights,
  productsFromSupplier,
  repeatedlyOverdue,
  type Range,
} from '@/server/services/analytics.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

/**
 * M10's first acceptance criterion: every measure matches a hand-calculated
 * result. So this suite builds a dataset small enough to add up on paper, and
 * every expectation below is a number worked out by hand rather than read back
 * from the code.
 *
 *   Branch A, on the test day:
 *     1 phone   GLOBAL + NEW CUT   cost 12,000   sold 20,000   cash
 *     1 phone   USED               cost  8,000   sold 11,000   credit
 *     2 cables                     cost    100ea sold    500ea cash
 *   Branch B:
 *     1 phone   GLOBAL             cost 10,000   sold 15,000   cash
 *   Expenses at A: 1,000
 *
 *   Revenue      = 20,000 + 11,000 + 1,000 + 15,000 = 47,000
 *   Cost         = 12,000 +  8,000 +   200 + 10,000 = 30,200
 *   Gross profit = 16,800
 *   Net (est.)   = 16,800 − 1,000 = 15,800
 */
suite('M10 analytics (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let phoneProductId: number
  let cableProductId: number
  let cashMethodId: number
  let buyerId: number
  let actor: AuthUser
  let branchAOnly: AuthUser
  let noProfit: AuthUser
  let ctx: AuditContext
  let range: Range
  const imei = (n: number) => String(37_900_000_000_000 + (stamp % 1_000_000) * 10 + n)
  const rs = (n: number) => BigInt(Math.round(n * 100))
  /** A day far in the past, so nothing else in the database lands in it. */
  const DAY = '2021-07-15'
  const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, '0')}:00:00+05:30`)

  async function stockPhone(n: number, opts: {
    mainType: 'GLOBAL' | 'USED'
    isNewCut?: boolean
    cost: number
    branchId: number
  }) {
    const { id } = await createDevice(actor, ctx, {
      productId: phoneProductId,
      identifiers: [imei(n)],
      mainType: opts.mainType,
      isNewCut: opts.isNewCut ?? false,
      purchasePricePaise: rs(opts.cost),
      branchId: opts.branchId,
      // Arrived on the day it was sold, like the cables.
      receivedAt: at(9),
    })
    return id
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M10 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `MXA${stamp}`.slice(0, 12), name: 'M10 Branch A' },
          { businessId, code: `MXB${stamp}`.slice(0, 12), name: 'M10 Branch B' },
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
      name: 'M10 Tester',
      email: 'm10@example.local',
      roleId: 0,
      permissions: new Set([
        'analytics.view',
        'analytics.view_profit',
        'inventory.view',
        'inventory.view_cost',
      ]),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    branchAOnly = { ...actor, branchIds: [branchA], canViewAllBranches: false }
    noProfit = {
      ...actor,
      permissions: new Set(['analytics.view']) as AuthUser['permissions'],
    }
    ctx = { actor: null, businessId, branchId: branchA }
    range = { from: DAY, to: DAY }

    buyerId = (await createParty(actor, ctx, 'customer', { name: `M10 Buyer ${stamp}` })).id
    const brandRow = await createBrand(actor, ctx, { name: `M10 Brand ${stamp}` })
    const mobiles = await createCategory(actor, ctx, {
      name: 'M10 Mobiles',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    const cables = await createCategory(actor, ctx, { name: 'M10 Cables', isSerialised: false })
    phoneProductId = (
      await createProduct(actor, ctx, {
        name: 'M10 Phone',
        categoryId: mobiles.id,
        brandId: brandRow.id,
      })
    ).id
    cableProductId = (
      await createProduct(actor, ctx, {
        name: 'M10 Cable',
        categoryId: cables.id,
        brandId: brandRow.id,
        defaultPurchasePricePaise: rs(100),
      })
    ).id

    await increaseStock(
      { businessId, occurredAt: at(9) },
      { productId: cableProductId, branchId: branchA, quantity: 10, movement: 'PURCHASE' },
    )

    // --- branch A ---------------------------------------------------------
    const newCutPhone = await stockPhone(1, {
      mainType: 'GLOBAL',
      isNewCut: true,
      cost: 12000,
      branchId: branchA,
    })
    await createSale(actor, ctx, {
      branchId: branchA,
      soldAt: at(10),
      lines: [
        { productId: phoneProductId, deviceId: newCutPhone, quantity: 1, unitPricePaise: rs(20000) },
      ],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(20000) }],
    })

    const usedPhone = await stockPhone(2, { mainType: 'USED', cost: 8000, branchId: branchA })
    await createSale(actor, ctx, {
      branchId: branchA,
      soldAt: at(11),
      customerId: buyerId,
      // Entirely on credit, so the payment mix has a credit figure to check.
      lines: [
        { productId: phoneProductId, deviceId: usedPhone, quantity: 1, unitPricePaise: rs(11000) },
      ],
      payments: [],
    })

    await createSale(actor, ctx, {
      branchId: branchA,
      soldAt: at(12),
      lines: [{ productId: cableProductId, quantity: 2, unitPricePaise: rs(500) }],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(1000) }],
    })

    await createExpense(actor, ctx, {
      branchId: branchA,
      categoryId: (
        await db
          .insert(schema.expenseCategory)
          .values({ businessId, name: 'M10 Rent' })
          .returning()
      )[0]!.id,
      paymentMethodId: cashMethodId,
      amountPaise: rs(1000),
      businessDate: DAY,
    })

    // --- branch B ---------------------------------------------------------
    const globalPhone = await stockPhone(3, {
      mainType: 'GLOBAL',
      cost: 10000,
      branchId: branchB,
    })
    await createSale(actor, ctx, {
      branchId: branchB,
      soldAt: at(13),
      lines: [
        { productId: phoneProductId, deviceId: globalPhone, quantity: 1, unitPricePaise: rs(15000) },
      ],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(15000) }],
    })
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
      await db.delete(schema.expenseCategory).where(eq(schema.expenseCategory.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.brand).where(eq(schema.brand.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('sales (FR-16)', () => {
    it('matches the hand-calculated totals', async () => {
      const t = await salesTotals(actor, range)
      // 20,000 + 11,000 + 1,000 + 15,000
      expect(t.revenuePaise).toBe(rs(47000))
      expect(t.orders).toBe(4)
      // 1 + 1 + 2 + 1
      expect(t.units).toBe(5)
      // 47,000 / 4 = 11,750 exactly
      expect(t.averageOrderPaise).toBe(rs(11750))
    })

    it('splits by branch, ranks by revenue, and the parts add up to the whole', async () => {
      const byBranch = await salesByBranch(actor, range)
      /*
       * Ranked by revenue, not by name. This was ordering on the second
       * SELECT column, which happened to be the branch name - so the owner's
       * branch comparison was sorted alphabetically.
       */
      expect(byBranch.map((b) => b.branchName)).toEqual(['M10 Branch A', 'M10 Branch B'])
      const a = byBranch.find((b) => b.branchId === branchA)!
      const b = byBranch.find((b) => b.branchId === branchB)!
      expect(a.revenuePaise).toBe(rs(32000))
      expect(b.revenuePaise).toBe(rs(15000))
      expect(a.revenuePaise + b.revenuePaise).toBe(rs(47000))
      expect(a.orders).toBe(3)
      expect(b.orders).toBe(1)
    })
  })

  /* --- criterion 2: the branch selector changes every figure ------------ */

  describe('the branch selector (criterion 2)', () => {
    it('one branch, the other, and both give three different answers', async () => {
      const both = await salesTotals(actor, range)
      const onlyA = await salesTotals(actor, { ...range, branchIds: [branchA] })
      const onlyB = await salesTotals(actor, { ...range, branchIds: [branchB] })

      expect(both.revenuePaise).toBe(rs(47000))
      expect(onlyA.revenuePaise).toBe(rs(32000))
      expect(onlyB.revenuePaise).toBe(rs(15000))
      expect(onlyA.revenuePaise + onlyB.revenuePaise).toBe(both.revenuePaise)

      // Two branches named explicitly is the same as all of them, here.
      const named = await salesTotals(actor, { ...range, branchIds: [branchA, branchB] })
      expect(named.revenuePaise).toBe(both.revenuePaise)
    })

    it('a branch-limited user asking for a branch they cannot see gets nothing', async () => {
      const sneaky = await salesTotals(branchAOnly, { ...range, branchIds: [branchB] })
      expect(sneaky.revenuePaise).toBe(0n)

      // And asking for everything gives them only their own branch.
      const theirs = await salesTotals(branchAOnly, range)
      expect(theirs.revenuePaise).toBe(rs(32000))
    })
  })

  /* --- criterion 3: GLOBAL, with NEW CUT split out --------------------- */

  describe('the mobile-type dimension (criterion 3)', () => {
    it('reports each main type separately, with GLOBAL split by NEW CUT', async () => {
      const types = await byMainType(actor, range)

      const newCut = types.find((t) => t.mainType === 'GLOBAL' && t.isNewCut)!
      const plainGlobal = types.find((t) => t.mainType === 'GLOBAL' && !t.isNewCut)!
      const used = types.find((t) => t.mainType === 'USED')!

      // GLOBAL · NEW CUT: sold 20,000, cost 12,000.
      expect(newCut.label).toBe('GLOBAL · NEW CUT')
      expect(newCut.revenuePaise).toBe(rs(20000))
      expect(newCut.profitPaise).toBe(rs(8000))
      // 8,000 / 20,000 = 40%
      expect(newCut.marginBasisPoints).toBe(4000)

      // Plain GLOBAL: sold 15,000, cost 10,000 — a different margin, which is
      // the whole point of splitting them.
      expect(plainGlobal.revenuePaise).toBe(rs(15000))
      expect(plainGlobal.profitPaise).toBe(rs(5000))
      expect(plainGlobal.marginBasisPoints).toBe(3333)

      expect(used.revenuePaise).toBe(rs(11000))
      expect(used.profitPaise).toBe(rs(3000))

      // NEW CUT is never a sixth type: it is GLOBAL, twice, split.
      expect(types.filter((t) => t.mainType === 'GLOBAL')).toHaveLength(2)
    })

    it('filters product performance to GLOBAL, and to NEW CUT within it', async () => {
      const allGlobal = await productPerformance(actor, range, { mainType: 'GLOBAL' })
      expect(allGlobal[0]!.revenuePaise).toBe(rs(35000))

      const onlyNewCut = await productPerformance(actor, range, {
        mainType: 'GLOBAL',
        isNewCut: true,
      })
      expect(onlyNewCut[0]!.revenuePaise).toBe(rs(20000))

      const notNewCut = await productPerformance(actor, range, {
        mainType: 'GLOBAL',
        isNewCut: false,
      })
      expect(notNewCut[0]!.revenuePaise).toBe(rs(15000))
    })

    it('counts stock on the shelf by type too', async () => {
      const onShelf = await stockByMainType(actor, range)
      // Everything registered was sold, so nothing is left.
      expect(onShelf.reduce((n, r) => n + r.units, 0)).toBe(0)
    })
  })

  describe('profit (FR-22)', () => {
    it('matches the hand-calculated profit and margin', async () => {
      const p = await profitSummary(actor, range)
      expect(p.revenuePaise).toBe(rs(47000))
      // 12,000 + 8,000 + (100 x 2) + 10,000
      expect(p.cogsPaise).toBe(rs(30200))
      expect(p.grossProfitPaise).toBe(rs(16800))
      expect(p.expensesPaise).toBe(rs(1000))
      expect(p.netProfitPaise).toBe(rs(15800))
      // 16,800 / 47,000 = 35.74%
      expect(p.marginBasisPoints).toBe(3574)
    })

    it('is refused to someone who may not see cost prices', async () => {
      await expect(profitSummary(noProfit, range)).rejects.toThrow(/cost prices/i)
    })
  })

  describe('brands (FR-18) and products (FR-17)', () => {
    it('rolls every product up to its brand', async () => {
      const brands = await brandPerformance(actor, range)
      expect(brands).toHaveLength(1)
      expect(brands[0]!.revenuePaise).toBe(rs(47000))
      expect(brands[0]!.units).toBe(5)
      expect(brands[0]!.profitPaise).toBe(rs(16800))
    })

    it('ranks products by revenue', async () => {
      const products = await productPerformance(actor, range)
      expect(products[0]!.productName).toBe('M10 Phone')
      expect(products[0]!.revenuePaise).toBe(rs(46000))
      const cable = products.find((p) => p.productName === 'M10 Cable')!
      expect(cable.revenuePaise).toBe(rs(1000))
      expect(cable.costPaise).toBe(rs(200))
    })
  })

  describe('payments (FR-23) and customers (FR-19)', () => {
    it('separates what was taken from what went out on credit', async () => {
      const mix = await paymentMix(actor, range)
      // 20,000 + 1,000 + 15,000 in cash; the 11,000 bill was all credit.
      expect(mix.takenPaise).toBe(rs(36000))
      expect(mix.creditPaise).toBe(rs(11000))
      expect(mix.revenuePaise).toBe(rs(47000))
      expect(mix.methods).toHaveLength(1)
      expect(mix.methods[0]!.amountPaise).toBe(rs(36000))
    })

    it('counts a first-time buyer as new', async () => {
      const c = await customerAnalytics(actor, range)
      expect(c.top).toHaveLength(1)
      expect(c.top[0]!.spendPaise).toBe(rs(11000))
      expect(c.top[0]!.isNew).toBe(true)
      expect(c.newCustomers).toBe(1)
    })
  })

  describe('inventory (FR-21)', () => {
    it('counts handsets as well as accessories, and reconciles', async () => {
      const m = await inventoryMovement(actor, range)

      /*
       * FR-21 wants the stock ledger AND device events. The ledger covers
       * accessories only: 10 cables in, 2 sold. The three handsets are in
       * device_event, and without them a phone shop's movement report would
       * describe the smaller half of its stock while `current` counted the
       * lot - so every handset vanished into "opening".
       */
      expect(m.purchases).toBe(13) // 10 cables + 3 handsets registered
      expect(m.sales).toBe(5) //  2 cables +  3 handsets sold

      // The identity that makes the report worth printing.
      expect(
        m.opening +
          m.purchases -
          m.sales +
          m.returns +
          m.transfersIn -
          m.transfersOut +
          m.adjustments,
      ).toBe(m.current)

      // Nothing was bought before this day, so it opened empty.
      expect(m.opening).toBe(0)
    })

    it('values what is on the shelf at cost', async () => {
      const s = await stockOnHand(actor, range)
      // 8 cables left at 100 each; every handset was sold.
      expect(s.accessoryUnits).toBe(8)
      expect(s.deviceUnits).toBe(0)
      expect(s.valuePaise).toBe(rs(800))
    })
  })

  describe('the rest of FR-19 – FR-24', () => {
    it('measures stock turnover against what is held', async () => {
      const t = await stockTurnover(actor, range)
      // 5 units sold, 8 cables left: 5/8 = 0.625, or 6250 basis points.
      expect(t.unitsSold).toBe(5)
      expect(t.unitsHeld).toBe(8)
      expect(t.turnoverBasisPoints).toBe(6250)
    })

    it('reports low and out-of-stock separately (FR-21)', async () => {
      // Nothing has a reorder point set, so neither list has anything to say.
      const alerts = await stockAlerts(actor, range)
      expect(alerts.low).toHaveLength(0)
      expect(alerts.outOfStock).toHaveLength(0)

      await db
        .update(schema.branchStock)
        .set({ minQuantity: 20 })
        .where(eq(schema.branchStock.productId, cableProductId))

      const after = await stockAlerts(actor, range)
      // 8 on hand against a minimum of 20: low, but not out.
      expect(after.low).toHaveLength(1)
      expect(after.low[0]!.quantity).toBe(8)
      expect(after.outOfStock).toHaveLength(0)

      await db
        .update(schema.branchStock)
        .set({ minQuantity: 0 })
        .where(eq(schema.branchStock.productId, cableProductId))
    })

    it('measures collection performance (FR-20)', async () => {
      const c = await collectionPerformance(actor, range)
      // 11,000 given on credit, nothing collected yet.
      expect(c.givenPaise).toBe(rs(11000))
      expect(c.collectedPaise).toBe(0n)
      expect(c.rateBasisPoints).toBe(0)
    })

    it('names customers who are late more than once (FR-20)', async () => {
      // One overdue bill is a slow week, not a pattern - so nobody yet.
      expect(await repeatedlyOverdue(actor, range)).toHaveLength(0)
    })

    it('lists what each supplier actually supplied (FR-24)', async () => {
      // Nothing was bought through a purchase in this window.
      expect(await productsFromSupplier(actor, range)).toHaveLength(0)
    })
  })

  describe('business insights (FR-35)', () => {
    it('groups revenue by weekday, because that is actionable', async () => {
      const days = await bestDays(actor, range)
      // Everything happened on one day: 15 July 2021 was a Thursday.
      expect(days).toHaveLength(1)
      expect(days[0]!.weekday).toBe('Thursday')
      expect(days[0]!.revenuePaise).toBe(rs(47000))
      expect(days[0]!.orders).toBe(4)
    })

    it('reports direction, not just size', async () => {
      const i = await insights(actor, range)
      expect(i.revenue.nowPaise).toBe(rs(47000))
      // Nothing sold the day before, so growth is unanswerable rather than
      // infinite.
      expect(i.revenue.beforePaise).toBe(0n)
      expect(i.revenue.changeBp).toBeNull()

      expect(i.topProducts[0]!.productName).toBe('M10 Phone')
      expect(i.topBrands[0]!.revenuePaise).toBe(rs(47000))
      expect(i.topBranches[0]!.branchName).toBe('M10 Branch A')
      // FR-35.3: every type compared, GLOBAL split by NEW CUT.
      expect(i.byMainType.filter((t) => t.mainType === 'GLOBAL')).toHaveLength(2)
      // FR-35.2: margin change is in percentage points, not percent of percent.
      expect(i.margin!.nowBp).toBe(3574)
      expect(i.margin!.changePoints).toBe(3574)
    })

    it('leaves margin out for someone who may not see cost', async () => {
      const i = await insights(noProfit, range)
      expect(i.margin).toBeNull()
      expect(i.revenue.nowPaise).toBe(rs(47000))
    })
  })

  describe('comparison periods', () => {
    it('offers the same number of days immediately before', () => {
      const prev = previousRange({ from: '2021-07-15', to: '2021-07-15' })
      expect(prev).toMatchObject({ from: '2021-07-14', to: '2021-07-14' })

      const week = previousRange({ from: '2021-07-08', to: '2021-07-14' })
      expect(week).toMatchObject({ from: '2021-07-01', to: '2021-07-07' })
    })

    it('reports growth in basis points, and says nothing when there is no base', async () => {
      const now = await salesTotals(actor, range)
      const before = await salesTotals(actor, previousRange(range))
      expect(before.revenuePaise).toBe(0n)
      // Growth from nothing is not 100% — it is unanswerable, and says so.
      expect(growthBasisPoints(now.revenuePaise, before.revenuePaise)).toBeNull()
      expect(growthBasisPoints(rs(150), rs(100))).toBe(5000)
      expect(growthBasisPoints(rs(50), rs(100))).toBe(-5000)
    })
  })

  /* --- criterion 4: a year of data, ten branches, under five seconds ---- */

  describe('performance (criterion 4)', () => {
    it('answers a twelve-month range quickly', async () => {
      const yearRange: Range = { from: '2021-01-01', to: '2021-12-31' }
      const started = performance.now()
      await Promise.all([
        salesTotals(actor, yearRange),
        salesByBranch(actor, yearRange),
        productPerformance(actor, yearRange),
        byMainType(actor, yearRange),
        profitSummary(actor, yearRange),
        paymentMix(actor, yearRange),
        inventoryMovement(actor, yearRange),
      ])
      expect(performance.now() - started).toBeLessThan(5000)
    })
  })

  describe('the source dimension (FR-38.4)', () => {
    it('filters sales, purchases and stock the same way', async () => {
      // Everything is ECITY: the businesses are separated (docs/02 §2.3).
      const ecity = await salesTotals(actor, { ...range, source: 'ECITY' })
      expect(ecity.revenuePaise).toBe(rs(47000))

      // Nothing came from the other system, so asking for it returns nothing -
      // rather than quietly ignoring the filter and returning everything.
      const legacy = await salesTotals(actor, { ...range, source: 'LEGACY' })
      expect(legacy.revenuePaise).toBe(0n)

      const legacyStock = await stockOnHand(actor, { ...range, source: 'LEGACY' })
      expect(legacyStock.deviceUnits).toBe(0)

      const legacyPurchases = await purchaseTotals(actor, { ...range, source: 'LEGACY' })
      expect(legacyPurchases.count).toBe(0)

      // BOTH, and omitting it, mean the same thing.
      const both = await salesTotals(actor, { ...range, source: 'BOTH' })
      expect(both.revenuePaise).toBe(rs(47000))
    })
  })

  describe('bad input', () => {
    it('refuses a range that ends before it starts', async () => {
      await expect(
        salesTotals(actor, { from: '2021-07-20', to: '2021-07-10' }),
      ).rejects.toThrow(/ends before it starts/i)
    })
  })
})
