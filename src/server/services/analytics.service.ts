import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  brand,
  branch,
  branchStock,
  category,
  customer,
  customerPayment,
  deviceEvent,
  deviceUnit,
  expense,
  paymentMethod,
  product,
  purchase,
  purchaseItem,
  sale,
  saleItem,
  salePayment,
  salesReturn,
  stockAdjustment,
  stockLedger,
  supplier,
  supplierLedgerEntry,
  supplierPayment,
  type MainType,
} from '@/server/db/schema'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { saleReceivedSql } from './customer-ledger.service'
import { AppError } from '@/server/http'
import { shopDateString } from '@/lib/date'

/**
 * Analytics (PRD FR-16 – FR-24, FR-35, FR-36).
 *
 * One query layer with one shape: a date range, a set of branches, and an
 * optional comparison period. Nine areas read from it rather than each
 * inventing its own filtering - which is how two screens end up disagreeing
 * about the same month.
 *
 * Every figure is computed live from the documents. There are no rollup
 * tables: at this shop's volume the queries are already well inside the five
 * second target in PRD §9.1, and a nightly rollup would add a refresh to keep
 * honest and a staleness window to explain. Revisit when the data is big
 * enough to need it - the shape of these functions would not change.
 */

export type Range = {
  /** Inclusive, in the shop's calendar (yyyy-mm-dd). */
  from: string
  to: string
  /** Empty means every branch the caller may see. */
  branchIds?: number[]
  /** FR-38.4. Kept, though with the businesses separated every row is ECITY. */
  source?: 'ECITY' | 'LEGACY' | 'BOTH'
}

/** The window a range covers, as timestamps in the shop's timezone. */
function windowOf(range: Range): { from: Date; to: Date } {
  const from = new Date(`${range.from}T00:00:00+05:30`)
  // Exclusive upper bound: a sale at 23:59 on the last day is inside.
  const to = new Date(`${range.to}T00:00:00+05:30`)
  to.setDate(to.getDate() + 1)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError('That date range is not valid.', 422, 'BAD_RANGE')
  }
  if (to <= from) throw new AppError('The range ends before it starts.', 422, 'BAD_RANGE')
  return { from, to }
}

/**
 * The same period, immediately before this one — for "versus last month".
 *
 * Measured in days rather than calendar months, so a 30-day comparison is
 * genuinely 30 days. Comparing February to January by name flatters February
 * every year.
 */
export function previousRange(range: Range): Range {
  const from = new Date(`${range.from}T00:00:00Z`)
  const to = new Date(`${range.to}T00:00:00Z`)
  /*
   * Both ends are midnight UTC, so the division is exact - `trunc` is here to
   * turn a float type into an integer, not to round anything. (Math.round is
   * banned project-wide because it usually means float money; this is days.)
   */
  const days = Math.trunc((to.getTime() - from.getTime()) / 86_400_000) + 1
  const prevTo = new Date(from.getTime() - 86_400_000)
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000)
  return {
    ...range,
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  }
}

/**
 * Which branches this query covers.
 *
 * Returns null only when the caller may see everything AND asked for
 * everything; otherwise a concrete list, so a branch-limited user asking for
 * a branch they cannot see gets nothing rather than everything.
 */
function branchesFor(actor: AuthUser, range: Range): number[] | null {
  const scope = branchScope(actor, null)
  const asked = range.branchIds?.length ? range.branchIds : null

  if (scope === null) return asked
  if (!asked) return scope.length ? scope : [-1]
  const allowed = asked.filter((id) => scope.includes(id))
  return allowed.length ? allowed : [-1]
}

/**
 * FR-38.4. The source dimension, applied wherever a table can answer it.
 *
 * `sale`, `purchase` and `device_unit` each carry a source. With the two
 * businesses separated (docs/02 §2.3) every row is ECITY, so this filters
 * nothing today - it is here so a later merge does not have to revisit nine
 * queries.
 */
function sourceCondition(range: Range, col: AnyPgColumn): SQL | undefined {
  if (!range.source || range.source === 'BOTH') return undefined
  return sql`${col} = ${range.source}`
}

function saleConditions(actor: AuthUser, range: Range): SQL[] {
  const { from, to } = windowOf(range)
  const conditions: SQL[] = [
    eq(sale.businessId, actor.businessId),
    gte(sale.soldAt, from),
    lt(sale.soldAt, to),
    // A voided bill is not a sale.
    sql`${sale.status} <> 'VOIDED'`,
  ]
  const branches = branchesFor(actor, range)
  if (branches) conditions.push(sql`${sale.branchId} in ${branches}`)
  const source = sourceCondition(range, sale.source)
  if (source) conditions.push(source)
  return conditions
}

/* ------------------------------------------------- FR-16 sales analytics - */

export type SalesTotals = {
  revenuePaise: bigint
  orders: number
  units: number
  averageOrderPaise: bigint
  discountPaise: bigint
  taxPaise: bigint
}

export async function salesTotals(actor: AuthUser, range: Range): Promise<SalesTotals> {
  const where = and(...saleConditions(actor, range))

  const [head, units] = await Promise.all([
    db
      .select({
        orders: sql<string>`count(*)`,
        revenue: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
        discount: sql<string>`coalesce(sum(${sale.discountPaise}), 0)`,
        tax: sql<string>`coalesce(sum(${sale.taxPaise}), 0)`,
      })
      .from(sale)
      .where(where),
    db
      .select({ units: sql<string>`coalesce(sum(${saleItem.quantity}), 0)` })
      .from(saleItem)
      .innerJoin(sale, eq(sale.id, saleItem.saleId))
      .where(where),
  ])

  const orders = Number(head[0]?.orders ?? 0)
  const revenue = BigInt(head[0]?.revenue ?? '0')

  return {
    revenuePaise: revenue,
    orders,
    units: Number(units[0]?.units ?? 0),
    // Integer division in paise: no float ever touches money (docs/03 §4.1).
    averageOrderPaise: orders > 0 ? revenue / BigInt(orders) : 0n,
    discountPaise: BigInt(head[0]?.discount ?? '0'),
    taxPaise: BigInt(head[0]?.tax ?? '0'),
  }
}

/** Revenue by day, for the trend chart. */
export async function salesByDay(actor: AuthUser, range: Range) {
  const rows = await db
    .select({
      day: sql<string>`to_char(${sale.soldAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      orders: sql<string>`count(*)`,
    })
    .from(sale)
    .where(and(...saleConditions(actor, range)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)

  return rows.map((r) => ({
    day: r.day,
    revenuePaise: BigInt(r.revenue),
    orders: Number(r.orders),
  }))
}

/** FR-16, FR-36.3. One row per branch, for the comparison table. */
export async function salesByBranch(actor: AuthUser, range: Range) {
  const rows = await db
    .select({
      branchId: sale.branchId,
      branchName: branch.name,
      revenue: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      orders: sql<string>`count(*)`,
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(and(...saleConditions(actor, range)))
    .groupBy(sale.branchId, branch.name)
    // By revenue. Written out rather than as `desc(sql`2`)`: an ordinal points
    // at whatever the second SELECT column happens to be, and this one was
    // pointing at the branch NAME - so the comparison sorted alphabetically.
    .orderBy(desc(sql`coalesce(sum(${sale.totalPaise}), 0)`))

  return rows.map((r) => ({
    branchId: r.branchId,
    branchName: r.branchName,
    revenuePaise: BigInt(r.revenue),
    orders: Number(r.orders),
  }))
}

/* ---------------------------------- FR-17, FR-22 product / profit by line - */

/**
 * Per-line revenue, cost and profit.
 *
 * Cost comes from the device for a handset and the product's purchase price
 * for an accessory. A line whose cost is unknown contributes revenue but no
 * profit, and says so - guessing a cost would put a number on the screen that
 * nobody could reconcile.
 */
const LINE_COST = sql<string>`coalesce(${deviceUnit.purchasePricePaise}, ${product.defaultPurchasePricePaise} * ${saleItem.quantity}, 0)`

export type ProductRow = {
  productId: number
  productName: string
  brandName: string | null
  units: number
  revenuePaise: bigint
  costPaise: bigint
  profitPaise: bigint
  /** Basis points, so no float. 2500 = 25%. */
  marginBasisPoints: number
}

function marginBp(revenue: bigint, profit: bigint): number {
  if (revenue <= 0n) return 0
  return Number((profit * 10_000n) / revenue)
}

export async function productPerformance(
  actor: AuthUser,
  range: Range,
  opts: { mainType?: MainType; isNewCut?: boolean; limit?: number } = {},
): Promise<ProductRow[]> {
  const conditions = saleConditions(actor, range)
  // FR-17, FR-35.3. The mobile-type dimension, with NEW CUT inside GLOBAL.
  if (opts.mainType) conditions.push(eq(saleItem.mainTypeSnapshot, opts.mainType))
  if (opts.isNewCut !== undefined) {
    conditions.push(eq(saleItem.isNewCutSnapshot, opts.isNewCut))
  }

  const rows = await db
    .select({
      productId: product.id,
      productName: product.name,
      brandName: brand.name,
      units: sql<string>`coalesce(sum(${saleItem.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleItem.lineTotalPaise}), 0)`,
      cost: sql<string>`coalesce(sum(${LINE_COST}), 0)`,
    })
    .from(saleItem)
    .innerJoin(sale, eq(sale.id, saleItem.saleId))
    .innerJoin(product, eq(product.id, saleItem.productId))
    .leftJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(deviceUnit, eq(deviceUnit.id, saleItem.deviceId))
    .where(and(...conditions))
    .groupBy(product.id, product.name, brand.name)
    .orderBy(desc(sql`coalesce(sum(${saleItem.lineTotalPaise}), 0)`))
    .limit(opts.limit ?? 25)

  return rows.map((r) => {
    const revenue = BigInt(r.revenue)
    const cost = BigInt(r.cost)
    return {
      productId: r.productId,
      productName: r.productName,
      brandName: r.brandName,
      units: Number(r.units),
      revenuePaise: revenue,
      costPaise: cost,
      profitPaise: revenue - cost,
      marginBasisPoints: marginBp(revenue, revenue - cost),
    }
  })
}

/** FR-17, FR-21, FR-35.3. The five main types, GLOBAL split by NEW CUT. */
export async function byMainType(actor: AuthUser, range: Range) {
  const rows = await db
    .select({
      mainType: saleItem.mainTypeSnapshot,
      isNewCut: saleItem.isNewCutSnapshot,
      units: sql<string>`coalesce(sum(${saleItem.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleItem.lineTotalPaise}), 0)`,
      cost: sql<string>`coalesce(sum(${LINE_COST}), 0)`,
    })
    .from(saleItem)
    .innerJoin(sale, eq(sale.id, saleItem.saleId))
    .innerJoin(product, eq(product.id, saleItem.productId))
    .leftJoin(deviceUnit, eq(deviceUnit.id, saleItem.deviceId))
    .where(and(...saleConditions(actor, range), sql`${saleItem.mainTypeSnapshot} is not null`))
    .groupBy(saleItem.mainTypeSnapshot, saleItem.isNewCutSnapshot)

  return rows.map((r) => {
    const revenue = BigInt(r.revenue)
    const cost = BigInt(r.cost)
    return {
      mainType: r.mainType!,
      isNewCut: r.isNewCut,
      /** "GLOBAL · NEW CUT" is its own line, never a sixth main type. */
      label: r.mainType === 'GLOBAL' && r.isNewCut ? 'GLOBAL · NEW CUT' : r.mainType!,
      units: Number(r.units),
      revenuePaise: revenue,
      costPaise: cost,
      profitPaise: revenue - cost,
      marginBasisPoints: marginBp(revenue, revenue - cost),
    }
  })
}

/* ------------------------------------------------- FR-18 brand analytics - */

export async function brandPerformance(actor: AuthUser, range: Range) {
  const rows = await db
    .select({
      brandId: brand.id,
      brandName: brand.name,
      units: sql<string>`coalesce(sum(${saleItem.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleItem.lineTotalPaise}), 0)`,
      cost: sql<string>`coalesce(sum(${LINE_COST}), 0)`,
    })
    .from(saleItem)
    .innerJoin(sale, eq(sale.id, saleItem.saleId))
    .innerJoin(product, eq(product.id, saleItem.productId))
    .innerJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(deviceUnit, eq(deviceUnit.id, saleItem.deviceId))
    .where(and(...saleConditions(actor, range)))
    .groupBy(brand.id, brand.name)
    .orderBy(desc(sql`coalesce(sum(${saleItem.lineTotalPaise}), 0)`))

  return rows.map((r) => {
    const revenue = BigInt(r.revenue)
    const cost = BigInt(r.cost)
    return {
      brandId: r.brandId,
      brandName: r.brandName,
      units: Number(r.units),
      revenuePaise: revenue,
      costPaise: cost,
      profitPaise: revenue - cost,
      marginBasisPoints: marginBp(revenue, revenue - cost),
    }
  })
}

/* ---------------------------------------------- FR-19 customer analytics - */

export async function customerAnalytics(actor: AuthUser, range: Range) {
  const { from } = windowOf(range)
  const conditions = saleConditions(actor, range)

  const rows = await db
    .select({
      customerId: sale.customerId,
      customerName: customer.name,
      orders: sql<string>`count(*)`,
      spend: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      /*
       * New if their first ever bill falls inside this range. Measured against
       * their whole history, not just the window, or every customer would look
       * new in a short one.
       */
      firstEver: sql<string>`(
        select min(s2.sold_at) from sale s2
        where s2.customer_id = "sale"."customer_id" and s2.status <> 'VOIDED'
      )`,
    })
    .from(sale)
    .innerJoin(customer, eq(customer.id, sale.customerId))
    .where(and(...conditions))
    .groupBy(sale.customerId, customer.name)
    .orderBy(desc(sql`coalesce(sum(${sale.totalPaise}), 0)`))
    .limit(25)

  const top = rows.map((r) => {
    const firstEver = r.firstEver ? new Date(r.firstEver) : null
    return {
      customerId: r.customerId!,
      customerName: r.customerName,
      orders: Number(r.orders),
      spendPaise: BigInt(r.spend),
      isNew: firstEver !== null && firstEver >= from,
    }
  })

  return {
    top,
    newCustomers: top.filter((c) => c.isNew).length,
    returningCustomers: top.filter((c) => !c.isNew).length,
  }
}

/* ------------------------------------------------ FR-23 payment analytics - */

export async function paymentMix(actor: AuthUser, range: Range) {
  const where = and(...saleConditions(actor, range))

  const [methods, totals] = await Promise.all([
    db
      .select({
        methodId: paymentMethod.id,
        methodName: paymentMethod.name,
        amount: sql<string>`coalesce(sum(${salePayment.amountPaise}), 0)`,
      })
      .from(salePayment)
      .innerJoin(sale, eq(sale.id, salePayment.saleId))
      .innerJoin(paymentMethod, eq(paymentMethod.id, salePayment.paymentMethodId))
      .where(where)
      .groupBy(paymentMethod.id, paymentMethod.name)
      .orderBy(desc(sql`coalesce(sum(${salePayment.amountPaise}), 0)`)),
    db
      .select({ revenue: sql<string>`coalesce(sum(${sale.totalPaise}), 0)` })
      .from(sale)
      .where(where),
  ])

  const taken = methods.reduce((sum, m) => sum + BigInt(m.amount), 0n)
  const revenue = BigInt(totals[0]?.revenue ?? '0')

  return {
    methods: methods.map((m) => ({
      methodId: m.methodId,
      methodName: m.methodName,
      amountPaise: BigInt(m.amount),
    })),
    /* Anything billed but not taken at the counter went out on credit. */
    creditPaise: revenue - taken,
    takenPaise: taken,
    revenuePaise: revenue,
  }
}

/* ---------------------------------------------- FR-21 inventory analytics - */

/**
 * FR-21's movement: Opening → Purchases → Sales → Returns → Adjustments →
 * Current, reconstructed from the stock ledger rather than stored.
 *
 * Opening is derived by working backwards from what is on the shelf now, so
 * the row always reconciles: opening + in − out = current, by construction.
 */
export async function inventoryMovement(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  // The query builder rather than raw SQL: postgres.js cannot bind a Date
  // through `db.execute`, and these bounds are timestamps.
  const rows = await db
    .select({
      movement: stockLedger.movement,
      quantity: sql<string>`coalesce(sum(${stockLedger.delta}), 0)`,
    })
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.businessId, actor.businessId),
        gte(stockLedger.occurredAt, from),
        lt(stockLedger.occurredAt, to),
        branches ? sql`${stockLedger.branchId} in ${branches}` : undefined,
      ),
    )
    .groupBy(stockLedger.movement)

  const byMovement = new Map(rows.map((r) => [r.movement as string, Number(r.quantity)]))

  /*
   * FR-21 says "from the stock ledger AND device events", and it has to.
   * `stock_ledger` covers non-serialised stock only, so on its own the row
   * described accessories while `current` counted handsets too - every phone
   * silently disappearing into "opening". In a phone shop that is the larger
   * half of the report.
   */
  const devices = await deviceMovement(actor, range)

  const current = await stockOnHand(actor, range)
  const purchases = (byMovement.get('PURCHASE') ?? 0) + devices.purchases
  const sales = (byMovement.get('SALE') ?? 0) + devices.sales
  const returns = (byMovement.get('RETURN') ?? 0) + devices.returns
  const transfersIn = (byMovement.get('TRANSFER_IN') ?? 0) + devices.transfersIn
  const transfersOut = (byMovement.get('TRANSFER_OUT') ?? 0) + devices.transfersOut
  const adjustments = (byMovement.get('ADJUSTMENT') ?? 0) + devices.adjustments

  const net = purchases + sales + returns + transfersIn + transfersOut + adjustments

  return {
    // Worked back from the shelf, so the arithmetic always closes.
    opening: current.units - net,
    purchases,
    // The ledger stores sales as negative; the report reads better positive.
    // `|| 0` because negating zero gives -0, which prints as "-0".
    sales: -sales || 0,
    returns,
    transfersIn,
    transfersOut: -transfersOut || 0,
    adjustments,
    current: current.units,
  }
}

/**
 * Handsets entering and leaving stock, from `device_event`.
 *
 * A device is one unit, so each event that changes whether it is on the shelf
 * counts as ±1. Events that change a device without moving it - INSPECTED,
 * RECLASSIFIED, RESERVED, REPAIRED - are deliberately absent: they are part of
 * its history, not of the stock count.
 */
const DEVICE_STEP: Record<string, { step: keyof DeviceMovement; delta: number }> = {
  PURCHASED: { step: 'purchases', delta: 1 },
  SOLD: { step: 'sales', delta: -1 },
  RETURNED: { step: 'returns', delta: 1 },
  TRANSFERRED_OUT: { step: 'transfersOut', delta: -1 },
  // Also emitted when a transfer is cancelled and the handset comes back.
  TRANSFERRED_IN: { step: 'transfersIn', delta: 1 },
  DAMAGED: { step: 'adjustments', delta: -1 },
  LOST: { step: 'adjustments', delta: -1 },
  // Its purchase was reversed, so it was never really stock.
  VOIDED: { step: 'adjustments', delta: -1 },
}

type DeviceMovement = {
  purchases: number
  sales: number
  returns: number
  transfersIn: number
  transfersOut: number
  adjustments: number
}

export async function deviceMovement(actor: AuthUser, range: Range): Promise<DeviceMovement> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      eventType: deviceEvent.eventType,
      n: sql<string>`count(*)`,
    })
    .from(deviceEvent)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceEvent.deviceId))
    .where(
      and(
        eq(deviceUnit.businessId, actor.businessId),
        gte(deviceEvent.occurredAt, from),
        lt(deviceEvent.occurredAt, to),
        sql`${deviceEvent.eventType} in ${Object.keys(DEVICE_STEP)}`,
        /*
         * Scoped by where the event happened, not by where the handset is
         * now - a phone sold at branch A and later transferred belongs to A's
         * sales for that day, wherever it ended up.
         */
        branches ? sql`${deviceEvent.branchId} in ${branches}` : undefined,
        sourceCondition(range, deviceUnit.source),
      ),
    )
    .groupBy(deviceEvent.eventType)

  const out: DeviceMovement = {
    purchases: 0,
    sales: 0,
    returns: 0,
    transfersIn: 0,
    transfersOut: 0,
    adjustments: 0,
  }
  for (const r of rows) {
    const mapped = DEVICE_STEP[r.eventType]
    if (mapped) out[mapped.step] += mapped.delta * Number(r.n)
  }
  return out
}

/** What is on the shelf right now, and what it is worth. */
export async function stockOnHand(actor: AuthUser, range: Range) {
  const branches = branchesFor(actor, range)

  const [accessories, devices] = await Promise.all([
    db
      .select({
        units: sql<string>`coalesce(sum(${branchStock.quantity}), 0)`,
        value: sql<string>`coalesce(sum(${branchStock.quantity} * coalesce(${product.defaultPurchasePricePaise}, 0)), 0)`,
      })
      .from(branchStock)
      .innerJoin(product, eq(product.id, branchStock.productId))
      .where(
        and(
          eq(product.businessId, actor.businessId),
          branches ? sql`${branchStock.branchId} in ${branches}` : undefined,
        ),
      ),
    db
      .select({
        units: sql<string>`count(*)`,
        value: sql<string>`coalesce(sum(coalesce(${deviceUnit.purchasePricePaise}, 0)), 0)`,
      })
      .from(deviceUnit)
      .where(
        and(
          eq(deviceUnit.businessId, actor.businessId),
          eq(deviceUnit.status, 'IN_STOCK'),
          branches ? sql`${deviceUnit.currentBranchId} in ${branches}` : undefined,
          sourceCondition(range, deviceUnit.source),
        ),
      ),
  ])

  return {
    accessoryUnits: Number(accessories[0]?.units ?? 0),
    deviceUnits: Number(devices[0]?.units ?? 0),
    units: Number(accessories[0]?.units ?? 0) + Number(devices[0]?.units ?? 0),
    valuePaise: BigInt(accessories[0]?.value ?? '0') + BigInt(devices[0]?.value ?? '0'),
  }
}

/** FR-21. Handsets in stock by main type, GLOBAL split by NEW CUT. */
export async function stockByMainType(actor: AuthUser, range: Range) {
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      units: sql<string>`count(*)`,
      value: sql<string>`coalesce(sum(coalesce(${deviceUnit.purchasePricePaise}, 0)), 0)`,
    })
    .from(deviceUnit)
    .where(
      and(
        eq(deviceUnit.businessId, actor.businessId),
        eq(deviceUnit.status, 'IN_STOCK'),
        branches ? sql`${deviceUnit.currentBranchId} in ${branches}` : undefined,
        sourceCondition(range, deviceUnit.source),
      ),
    )
    .groupBy(deviceUnit.mainType, deviceUnit.isNewCut)
    .orderBy(asc(deviceUnit.mainType))

  return rows.map((r) => ({
    mainType: r.mainType,
    isNewCut: r.isNewCut,
    label: r.mainType === 'GLOBAL' && r.isNewCut ? 'GLOBAL · NEW CUT' : r.mainType,
    units: Number(r.units),
    valuePaise: BigInt(r.value),
  }))
}

/** FR-21. Nothing sold in the window, but sitting on a shelf. */
export async function deadStock(actor: AuthUser, range: Range, limit = 20) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      id: deviceUnit.id,
      identifier: deviceUnit.primaryIdentifier,
      productName: product.name,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      costPaise: deviceUnit.purchasePricePaise,
      since: deviceUnit.createdAt,
      branchName: branch.name,
    })
    .from(deviceUnit)
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
    .where(
      and(
        eq(deviceUnit.businessId, actor.businessId),
        eq(deviceUnit.status, 'IN_STOCK'),
        // In stock before the window opened, and still here at the end of it.
        lt(deviceUnit.createdAt, from),
        lt(deviceUnit.createdAt, to),
        branches ? sql`${deviceUnit.currentBranchId} in ${branches}` : undefined,
        sourceCondition(range, deviceUnit.source),
      ),
    )
    .orderBy(asc(deviceUnit.createdAt))
    .limit(limit)

  return rows
}

/* ------------------------------------------------ FR-22 profit and money - */

export type ProfitSummary = {
  revenuePaise: bigint
  cogsPaise: bigint
  grossProfitPaise: bigint
  expensesPaise: bigint
  netProfitPaise: bigint
  marginBasisPoints: number
}

export async function profitSummary(actor: AuthUser, range: Range): Promise<ProfitSummary> {
  if (!hasPermission(actor, 'analytics.view_profit')) {
    throw new AppError('Profit needs permission to see cost prices.', 403, 'FORBIDDEN')
  }

  const branches = branchesFor(actor, range)
  const [lines, spend] = await Promise.all([
    db
      .select({
        revenue: sql<string>`coalesce(sum(${saleItem.lineTotalPaise}), 0)`,
        cost: sql<string>`coalesce(sum(${LINE_COST}), 0)`,
      })
      .from(saleItem)
      .innerJoin(sale, eq(sale.id, saleItem.saleId))
      .innerJoin(product, eq(product.id, saleItem.productId))
      .leftJoin(deviceUnit, eq(deviceUnit.id, saleItem.deviceId))
      .where(and(...saleConditions(actor, range))),
    db
      .select({ total: sql<string>`coalesce(sum(${expense.amountPaise}), 0)` })
      .from(expense)
      .where(
        and(
          eq(expense.businessId, actor.businessId),
          gte(expense.businessDate, range.from),
          sql`${expense.businessDate} <= ${range.to}`,
          isNull(expense.voidedAt),
          branches ? sql`${expense.branchId} in ${branches}` : undefined,
        ),
      ),
  ])

  const revenue = BigInt(lines[0]?.revenue ?? '0')
  const cogs = BigInt(lines[0]?.cost ?? '0')
  const gross = revenue - cogs
  const expenses = BigInt(spend[0]?.total ?? '0')

  return {
    revenuePaise: revenue,
    cogsPaise: cogs,
    grossProfitPaise: gross,
    expensesPaise: expenses,
    /* "Estimated" in FR-15.1: it is gross profit less recorded expenses, not
     * an accountant's net. Salaries and rent only count if someone booked
     * them as expenses. */
    netProfitPaise: gross - expenses,
    marginBasisPoints: marginBp(revenue, gross),
  }
}

/* ---------------------------------------------- FR-24 supplier analytics - */

export async function supplierAnalytics(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      supplierId: supplier.id,
      supplierName: supplier.name,
      purchases: sql<string>`count(distinct ${purchase.id})`,
      value: sql<string>`coalesce(sum(${purchase.totalPaise}), 0)`,
    })
    .from(purchase)
    .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
    .where(
      and(
        eq(purchase.businessId, actor.businessId),
        gte(purchase.purchaseDate, from),
        lt(purchase.purchaseDate, to),
        sql`${purchase.status} <> 'REVERSED'`,
        branches ? sql`${purchase.branchId} in ${branches}` : undefined,
        sourceCondition(range, purchase.source),
      ),
    )
    .groupBy(supplier.id, supplier.name)
    .orderBy(desc(sql`coalesce(sum(${purchase.totalPaise}), 0)`))
    .limit(25)

  return rows.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    purchases: Number(r.purchases),
    valuePaise: BigInt(r.value),
  }))
}

/** FR-15.1. What was bought in the window — the dashboard lists it. */
export async function purchaseTotals(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      count: sql<string>`count(*)`,
      value: sql<string>`coalesce(sum(${purchase.totalPaise}), 0)`,
    })
    .from(purchase)
    .where(
      and(
        eq(purchase.businessId, actor.businessId),
        gte(purchase.purchaseDate, from),
        lt(purchase.purchaseDate, to),
        sql`${purchase.status} <> 'REVERSED'`,
        branches ? sql`${purchase.branchId} in ${branches}` : undefined,
        sourceCondition(range, purchase.source),
      ),
    )

  return { count: Number(rows[0]?.count ?? 0), valuePaise: BigInt(rows[0]?.value ?? '0') }
}

/* ------------------------------------------------------ returns, for FR-16 */

export async function returnsTotals(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      count: sql<string>`count(*)`,
      value: sql<string>`coalesce(sum(${salesReturn.totalPaise}), 0)`,
      refunded: sql<string>`coalesce(sum(${salesReturn.refundedPaise}), 0)`,
    })
    .from(salesReturn)
    .where(
      and(
        eq(salesReturn.businessId, actor.businessId),
        gte(salesReturn.returnedAt, from),
        lt(salesReturn.returnedAt, to),
        branches ? sql`${salesReturn.branchId} in ${branches}` : undefined,
      ),
    )

  return {
    count: Number(rows[0]?.count ?? 0),
    valuePaise: BigInt(rows[0]?.value ?? '0'),
    refundedPaise: BigInt(rows[0]?.refunded ?? '0'),
  }
}

/* ------------------------------------------------------------- helpers --- */

/** Today, in the shop's calendar — the default range for a dashboard. */
export function today(): Range {
  const d = shopDateString()
  return { from: d, to: d }
}

/** Growth between two figures, in basis points. Null when there is no base. */
export function growthBasisPoints(now: bigint, before: bigint): number | null {
  if (before <= 0n) return null
  return Number(((now - before) * 10_000n) / before)
}

export { branchesFor as visibleBranchesForRange }

/** Which branches a user may pick from, for the selector. */
export async function selectableBranches(actor: AuthUser) {
  const scope = branchScope(actor, null)
  const rows = await db
    .select({ id: branch.id, name: branch.name, code: branch.code })
    .from(branch)
    .where(and(eq(branch.businessId, actor.businessId), eq(branch.status, 'ACTIVE')))
    .orderBy(asc(branch.name))
  return scope === null ? rows : rows.filter((b) => scope.includes(b.id))
}

/** FR-24, for the supplier page: what is still owed, business-wide. */
export async function supplierOutstandingTotal(actor: AuthUser) {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${supplierLedgerEntry.amountPaise}), 0)` })
    .from(supplierLedgerEntry)
    .where(eq(supplierLedgerEntry.businessId, actor.businessId))
  return BigInt(rows[0]?.total ?? '0')
}

/** Money out to suppliers in the window, for the payment page. */
export async function supplierPaymentsTotal(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${supplierPayment.amountPaise}), 0)` })
    .from(supplierPayment)
    .where(
      and(
        eq(supplierPayment.businessId, actor.businessId),
        gte(supplierPayment.paidOn, from),
        lt(supplierPayment.paidOn, to),
        isNull(supplierPayment.voidedAt),
        branches ? sql`${supplierPayment.branchId} in ${branches}` : undefined,
      ),
    )
  return BigInt(rows[0]?.total ?? '0')
}

/** Adjustments in the window, for the inventory page's movement row. */
export async function adjustmentCount(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(stockAdjustment)
    .where(
      and(
        eq(stockAdjustment.businessId, actor.businessId),
        gte(stockAdjustment.adjustedAt, from),
        lt(stockAdjustment.adjustedAt, to),
        branches ? sql`${stockAdjustment.branchId} in ${branches}` : undefined,
      ),
    )
  return Number(rows[0]?.n ?? 0)
}

/** Categories, for the profit page's filter. */
export async function listCategoriesForFilter(actor: AuthUser) {
  return db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(eq(category.businessId, actor.businessId))
    .orderBy(asc(category.name))
}

/* --------------------------------------------- FR-21, the rest of stock - */

/**
 * Stock turnover: units sold in the window against what is on the shelf now.
 *
 * Expressed in basis points rather than a ratio, so no float touches it. 200
 * means twice: the shop sold two of everything it currently holds.
 */
export async function stockTurnover(actor: AuthUser, range: Range) {
  const [sold, held] = await Promise.all([salesTotals(actor, range), stockOnHand(actor, range)])
  return {
    unitsSold: sold.units,
    unitsHeld: held.units,
    turnoverBasisPoints:
      held.units > 0 ? Math.trunc((sold.units * 10_000) / held.units) : null,
  }
}

/** FR-21. At or below the reorder point, and completely out. */
export async function stockAlerts(actor: AuthUser, range: Range) {
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      productId: product.id,
      productName: product.name,
      branchName: branch.name,
      quantity: branchStock.quantity,
      minQuantity: branchStock.minQuantity,
    })
    .from(branchStock)
    .innerJoin(product, eq(product.id, branchStock.productId))
    .innerJoin(branch, eq(branch.id, branchStock.branchId))
    .where(
      and(
        eq(product.businessId, actor.businessId),
        sql`${branchStock.minQuantity} > 0`,
        sql`${branchStock.quantity} <= ${branchStock.minQuantity}`,
        branches ? sql`${branchStock.branchId} in ${branches}` : undefined,
      ),
    )
    .orderBy(asc(branchStock.quantity))
    .limit(25)

  return {
    low: rows.filter((r) => r.quantity > 0),
    outOfStock: rows.filter((r) => r.quantity <= 0),
  }
}

/* ------------------------------------- FR-19, FR-20, the rest of credit - */

/**
 * FR-20. How well the shop actually collects: what was billed on credit in the
 * window against what came in against it.
 *
 * A collection rate above 100% is normal and correct - money often arrives for
 * bills raised before this window.
 */
export async function collectionPerformance(actor: AuthUser, range: Range) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const [mix, collected] = await Promise.all([
    paymentMix(actor, range),
    db
      .select({ total: sql<string>`coalesce(sum(${customerPayment.amountPaise}), 0)` })
      .from(customerPayment)
      .where(
        and(
          eq(customerPayment.businessId, actor.businessId),
          gte(customerPayment.receivedOn, from),
          lt(customerPayment.receivedOn, to),
          isNull(customerPayment.voidedAt),
          branches ? sql`${customerPayment.branchId} in ${branches}` : undefined,
        ),
      ),
  ])

  const collectedPaise = BigInt(collected[0]?.total ?? '0')
  return {
    givenPaise: mix.creditPaise,
    collectedPaise,
    rateBasisPoints:
      mix.creditPaise > 0n ? Number((collectedPaise * 10_000n) / mix.creditPaise) : null,
  }
}

/**
 * FR-20. Customers who are late more than once.
 *
 * One overdue bill is a slow week; several is a pattern, and the point of the
 * report is to tell them apart.
 */
export async function repeatedlyOverdue(actor: AuthUser, range: Range, limit = 15) {
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      customerId: sale.customerId,
      customerName: customer.name,
      overdueBills: sql<string>`count(*)`,
      owedPaise: sql<string>`coalesce(sum(${sale.totalPaise} - ${saleReceivedSql()}), 0)`,
    })
    .from(sale)
    .innerJoin(customer, eq(customer.id, sale.customerId))
    .where(
      and(
        eq(sale.businessId, actor.businessId),
        sql`${sale.dueDate} is not null`,
        lt(sale.dueDate, new Date()),
        sql`${sale.status} <> 'VOIDED'`,
        // Still owing something: a bill paid late is not overdue any more.
        sql`${sale.totalPaise} > ${saleReceivedSql()}`,
        branches ? sql`${sale.branchId} in ${branches}` : undefined,
      ),
    )
    .groupBy(sale.customerId, customer.name)
    .having(sql`count(*) > 1`)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)

  return rows.map((r) => ({
    customerId: r.customerId!,
    customerName: r.customerName,
    overdueBills: Number(r.overdueBills),
    owedPaise: BigInt(r.owedPaise),
  }))
}

/* ----------------------------------------- FR-24, what a supplier sells - */

export async function productsFromSupplier(actor: AuthUser, range: Range, limit = 25) {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      supplierName: supplier.name,
      productName: product.name,
      units: sql<string>`coalesce(sum(${purchaseItem.quantity}), 0)`,
      value: sql<string>`coalesce(sum(${purchaseItem.unitCostPaise} * ${purchaseItem.quantity}), 0)`,
    })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchase.id, purchaseItem.purchaseId))
    .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
    .innerJoin(product, eq(product.id, purchaseItem.productId))
    .where(
      and(
        eq(purchase.businessId, actor.businessId),
        gte(purchase.purchaseDate, from),
        lt(purchase.purchaseDate, to),
        sql`${purchase.status} <> 'REVERSED'`,
        branches ? sql`${purchase.branchId} in ${branches}` : undefined,
        sourceCondition(range, purchase.source),
      ),
    )
    .groupBy(supplier.name, product.name)
    .orderBy(desc(sql`coalesce(sum(${purchaseItem.unitCostPaise} * ${purchaseItem.quantity}), 0)`))
    .limit(limit)

  return rows.map((r) => ({
    supplierName: r.supplierName,
    productName: r.productName,
    units: Number(r.units),
    valuePaise: BigInt(r.value),
  }))
}

/* ----------------------------------------------- FR-35 business insights - */

/**
 * FR-35.1. Which days of the week actually earn.
 *
 * Grouped by weekday rather than by date, because "we are dead on Tuesdays" is
 * a decision a shop can act on and "the 14th was slow" is not.
 */
export async function bestDays(actor: AuthUser, range: Range) {
  const rows = await db
    .select({
      weekday: sql<string>`to_char(${sale.soldAt} at time zone 'Asia/Kolkata', 'Day')`,
      dow: sql<string>`extract(dow from ${sale.soldAt} at time zone 'Asia/Kolkata')`,
      revenue: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      orders: sql<string>`count(*)`,
    })
    .from(sale)
    .where(and(...saleConditions(actor, range)))
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`2`)

  return rows.map((r) => ({
    weekday: r.weekday.trim(),
    revenuePaise: BigInt(r.revenue),
    orders: Number(r.orders),
  }))
}

/**
 * FR-35.1 – FR-35.3, in one place: what changed, and what is doing well.
 *
 * Everything here is this period against the one immediately before it, so
 * "up" and "down" mean something rather than being a figure on its own.
 */
export async function insights(actor: AuthUser, range: Range) {
  const prev = previousRange(range)
  const canSeeProfit = hasPermission(actor, 'analytics.view_profit')

  const [now, before, days, products, brands, branches, types, credit, dead] = await Promise.all([
    salesTotals(actor, range),
    salesTotals(actor, prev),
    bestDays(actor, range),
    productPerformance(actor, range, { limit: 5 }),
    brandPerformance(actor, range),
    salesByBranch(actor, range),
    byMainType(actor, range),
    collectionPerformance(actor, range),
    deadStock(actor, range, 5),
  ])

  const [profitNow, profitBefore] = canSeeProfit
    ? await Promise.all([profitSummary(actor, range), profitSummary(actor, prev)])
    : [null, null]

  return {
    revenue: {
      nowPaise: now.revenuePaise,
      beforePaise: before.revenuePaise,
      changeBp: growthBasisPoints(now.revenuePaise, before.revenuePaise),
    },
    averageOrder: {
      nowPaise: now.averageOrderPaise,
      beforePaise: before.averageOrderPaise,
      changeBp: growthBasisPoints(now.averageOrderPaise, before.averageOrderPaise),
    },
    margin:
      profitNow && profitBefore
        ? {
            nowBp: profitNow.marginBasisPoints,
            beforeBp: profitBefore.marginBasisPoints,
            // Margin moves in percentage points, not percent of a percent.
            changePoints: profitNow.marginBasisPoints - profitBefore.marginBasisPoints,
          }
        : null,
    credit,
    bestDays: [...days].sort((a, b) => (b.revenuePaise > a.revenuePaise ? 1 : -1)),
    topProducts: products,
    topBrands: brands.slice(0, 5),
    topBranches: branches.slice(0, 5),
    byMainType: types,
    slowStock: dead,
  }
}
