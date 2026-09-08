import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  branch,
  customer,
  dailyClosing,
  deviceUnit,
  expense,
  expenseCategory,
  product,
  purchase,
  sale,
  saleItem,
  supplier,
} from '@/server/db/schema'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { AppError } from '@/server/http'
import { customerDues } from './customer-ledger.service'
import { byMainType, profitSummary, type Range } from './analytics.service'
import type { ExportSpec } from './export.service'

/**
 * The report centre (PRD FR-25.1 – FR-25.4).
 *
 * Ten families, each returning the same shape the export layer takes, so a
 * report is written once and comes out as a screen, a CSV, a spreadsheet or a
 * PDF without being described four times.
 *
 * These read the same query layer the dashboards use wherever the figures
 * overlap - a report and a dashboard disagreeing about last month is the
 * failure this avoids.
 */

export const REPORTS = {
  sales: 'Sales',
  purchases: 'Purchases',
  inventory: 'Inventory',
  financial: 'Financial',
  credit: 'Credit',
  tax: 'Tax',
  reconciliation: 'Reconciliation',
  branches: 'Branch comparison',
  customers: 'Customers',
  suppliers: 'Suppliers',
} as const

export type ReportName = keyof typeof REPORTS

function windowOf(range: Range) {
  const from = new Date(`${range.from}T00:00:00+05:30`)
  const to = new Date(`${range.to}T00:00:00+05:30`)
  to.setDate(to.getDate() + 1)
  return { from, to }
}

function branchesFor(actor: AuthUser, range: Range): number[] | null {
  const scope = branchScope(actor, null)
  const asked = range.branchIds?.length ? range.branchIds : null
  if (scope === null) return asked
  if (!asked) return scope.length ? scope : [-1]
  const allowed = asked.filter((id) => scope.includes(id))
  return allowed.length ? allowed : [-1]
}

/* --------------------------------------------------------------- sales --- */

async function salesReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt,
      branchName: branch.name,
      customerName: customer.name,
      subtotalPaise: sale.subtotalPaise,
      discountPaise: sale.discountPaise,
      taxPaise: sale.taxPaise,
      totalPaise: sale.totalPaise,
      status: sale.status,
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .leftJoin(customer, eq(customer.id, sale.customerId))
    .where(
      and(
        eq(sale.businessId, actor.businessId),
        gte(sale.soldAt, from),
        lt(sale.soldAt, to),
        branches ? sql`${sale.branchId} in ${branches}` : undefined,
      ),
    )
    .orderBy(desc(sale.soldAt))

  return {
    name: 'sales',
    title: 'Sales',
    subtitle: `${range.from} to ${range.to}`,
    columns: [
      { key: 'invoiceNumber', header: 'Invoice' },
      { key: 'soldAt', header: 'When' },
      { key: 'branchName', header: 'Branch' },
      { key: 'customerName', header: 'Customer' },
      { key: 'subtotalPaise', header: 'Subtotal', money: true, align: 'right' },
      { key: 'discountPaise', header: 'Discount', money: true, align: 'right' },
      { key: 'taxPaise', header: 'Tax', money: true, align: 'right' },
      { key: 'totalPaise', header: 'Total', money: true, align: 'right' },
      { key: 'status', header: 'Status' },
    ],
    rows: rows.map((r) => ({ ...r, customerName: r.customerName ?? 'Walk-in' })),
  }
}

/* ----------------------------------------------------------- purchases --- */

async function purchasesReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      purchaseNumber: purchase.purchaseNumber,
      purchaseDate: purchase.purchaseDate,
      branchName: branch.name,
      supplierName: supplier.name,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber,
      totalPaise: purchase.totalPaise,
      status: purchase.status,
    })
    .from(purchase)
    .innerJoin(branch, eq(branch.id, purchase.branchId))
    .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
    .where(
      and(
        eq(purchase.businessId, actor.businessId),
        gte(purchase.purchaseDate, from),
        lt(purchase.purchaseDate, to),
        branches ? sql`${purchase.branchId} in ${branches}` : undefined,
      ),
    )
    .orderBy(desc(purchase.purchaseDate))

  return {
    name: 'purchases',
    title: 'Purchases',
    subtitle: `${range.from} to ${range.to}`,
    columns: [
      { key: 'purchaseNumber', header: 'Number' },
      { key: 'purchaseDate', header: 'Date' },
      { key: 'branchName', header: 'Branch' },
      { key: 'supplierName', header: 'Supplier' },
      { key: 'supplierInvoiceNumber', header: 'Their bill' },
      { key: 'totalPaise', header: 'Total', money: true, align: 'right' },
      { key: 'status', header: 'Status' },
    ],
    rows,
  }
}

/* ----------------------------------------------------------- inventory --- */

/**
 * FR-25.2 and the M11 acceptance criterion: the five main types, with GLOBAL
 * split by NEW CUT. The handsets are listed individually because an inventory
 * report a shop can act on names the phone, not just the count.
 */
async function inventoryReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const branches = branchesFor(actor, range)
  const showCost = hasPermission(actor, 'inventory.view_cost')

  const rows = await db
    .select({
      identifier: deviceUnit.primaryIdentifier,
      productName: product.name,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      status: deviceUnit.status,
      branchName: branch.name,
      costPaise: deviceUnit.purchasePricePaise,
      since: deviceUnit.createdAt,
    })
    .from(deviceUnit)
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
    .where(
      and(
        eq(deviceUnit.businessId, actor.businessId),
        eq(deviceUnit.status, 'IN_STOCK'),
        branches ? sql`${deviceUnit.currentBranchId} in ${branches}` : undefined,
      ),
    )
    .orderBy(asc(deviceUnit.mainType), asc(product.name))

  return {
    name: 'inventory',
    title: 'Inventory',
    subtitle: 'In stock now',
    columns: [
      { key: 'identifier', header: 'IMEI / serial' },
      { key: 'productName', header: 'Product' },
      { key: 'type', header: 'Main type' },
      { key: 'branchName', header: 'Branch' },
      { key: 'since', header: 'In stock since' },
      ...(showCost
        ? [{ key: 'costPaise', header: 'Cost', money: true, align: 'right' as const }]
        : []),
    ],
    rows: rows.map((r) => ({
      ...r,
      // GLOBAL · NEW CUT is a line of its own, never a sixth type.
      type: r.mainType === 'GLOBAL' && r.isNewCut ? 'GLOBAL · NEW CUT' : r.mainType,
    })),
  }
}

/* ----------------------------------------------------------- financial --- */

async function financialReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  if (!hasPermission(actor, 'analytics.view_profit')) {
    throw new AppError('This report needs permission to see cost prices.', 403, 'FORBIDDEN')
  }

  const [profit, types] = await Promise.all([
    profitSummary(actor, range),
    byMainType(actor, range),
  ])

  const branches = branchesFor(actor, range)
  const expenses = await db
    .select({
      categoryName: expenseCategory.name,
      total: sql<string>`coalesce(sum(${expense.amountPaise}), 0)`,
    })
    .from(expense)
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
    .where(
      and(
        eq(expense.businessId, actor.businessId),
        gte(expense.businessDate, range.from),
        sql`${expense.businessDate} <= ${range.to}`,
        isNull(expense.voidedAt),
        branches ? sql`${expense.branchId} in ${branches}` : undefined,
      ),
    )
    .groupBy(expenseCategory.name)

  /*
   * One flat table rather than nested sections: it has to survive being a CSV,
   * where a heading is just another row.
   */
  const rows: Record<string, unknown>[] = [
    { line: 'Revenue', amountPaise: profit.revenuePaise },
    { line: 'Cost of goods sold', amountPaise: profit.cogsPaise },
    { line: 'Gross profit', amountPaise: profit.grossProfitPaise },
    ...types.map((t) => ({
      line: `  Gross profit — ${t.label}`,
      amountPaise: t.profitPaise,
    })),
    ...expenses.map((e) => ({
      line: `  Expenses — ${e.categoryName}`,
      amountPaise: BigInt(e.total),
    })),
    { line: 'Expenses', amountPaise: profit.expensesPaise },
    { line: 'Estimated net profit', amountPaise: profit.netProfitPaise },
  ]

  return {
    name: 'financial',
    title: 'Financial summary',
    subtitle: `${range.from} to ${range.to} · net is gross less recorded expenses`,
    columns: [
      { key: 'line', header: 'Line' },
      { key: 'amountPaise', header: 'Amount', money: true, align: 'right' },
    ],
    rows,
  }
}

/* -------------------------------------------------------------- credit --- */

async function creditReport(actor: AuthUser): Promise<ExportSpec> {
  const dues = await customerDues(actor, { page: 1, pageSize: 1000 })

  return {
    name: 'credit',
    title: 'Customer dues',
    subtitle: 'Outstanding now, aged by bill',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'phone', header: 'Phone' },
      { key: 'balancePaise', header: 'Owed', money: true, align: 'right' },
      { key: 'b0', header: '0–7 days', money: true, align: 'right' },
      { key: 'b8', header: '8–30 days', money: true, align: 'right' },
      { key: 'b31', header: '31–60 days', money: true, align: 'right' },
      { key: 'b60', header: 'Over 60', money: true, align: 'right' },
    ],
    rows: dues.rows.map((r) => ({
      customerName: r.customerName,
      phone: r.phone,
      balancePaise: r.balancePaise,
      b0: r.buckets['0-7'],
      b8: r.buckets['8-30'],
      b31: r.buckets['31-60'],
      b60: r.buckets['60+'],
    })),
  }
}

/* ----------------------------------------------------------------- tax --- */

/**
 * FR-25.1's tax report: what was charged, by rate.
 *
 * Reads the snapshotted per-line figures rather than recomputing, so it can
 * never disagree with the invoices already issued.
 */
async function taxReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      rate: saleItem.taxRateBasisPoints,
      hsn: saleItem.hsnCodeSnapshot,
      taxablePaise: sql<string>`coalesce(sum(${saleItem.taxablePaise}), 0)`,
      cgstPaise: sql<string>`coalesce(sum(${saleItem.cgstPaise}), 0)`,
      sgstPaise: sql<string>`coalesce(sum(${saleItem.sgstPaise}), 0)`,
      igstPaise: sql<string>`coalesce(sum(${saleItem.igstPaise}), 0)`,
      taxPaise: sql<string>`coalesce(sum(${saleItem.taxPaise}), 0)`,
    })
    .from(saleItem)
    .innerJoin(sale, eq(sale.id, saleItem.saleId))
    .where(
      and(
        eq(sale.businessId, actor.businessId),
        gte(sale.soldAt, from),
        lt(sale.soldAt, to),
        sql`${sale.status} <> 'VOIDED'`,
        branches ? sql`${sale.branchId} in ${branches}` : undefined,
      ),
    )
    .groupBy(saleItem.taxRateBasisPoints, saleItem.hsnCodeSnapshot)
    .orderBy(asc(saleItem.taxRateBasisPoints))

  return {
    name: 'tax',
    title: 'Tax summary',
    subtitle: `${range.from} to ${range.to} · HSN-wise, from the invoices as issued`,
    columns: [
      { key: 'hsn', header: 'HSN' },
      { key: 'ratePercent', header: 'Rate', align: 'right' },
      { key: 'taxablePaise', header: 'Taxable', money: true, align: 'right' },
      { key: 'cgstPaise', header: 'CGST', money: true, align: 'right' },
      { key: 'sgstPaise', header: 'SGST', money: true, align: 'right' },
      { key: 'igstPaise', header: 'IGST', money: true, align: 'right' },
      { key: 'taxPaise', header: 'Total tax', money: true, align: 'right' },
    ],
    rows: rows.map((r) => ({
      hsn: r.hsn ?? '—',
      ratePercent: `${(r.rate / 100).toFixed(2)}%`,
      taxablePaise: BigInt(r.taxablePaise),
      cgstPaise: BigInt(r.cgstPaise),
      sgstPaise: BigInt(r.sgstPaise),
      igstPaise: BigInt(r.igstPaise),
      taxPaise: BigInt(r.taxPaise),
    })),
  }
}

/* -------------------------------------------------- reconciliation ------- */

async function reconciliationReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      businessDate: dailyClosing.businessDate,
      branchName: branch.name,
      expectedCashPaise: dailyClosing.expectedCashPaise,
      countedCashPaise: dailyClosing.countedCashPaise,
      cashDifferencePaise: dailyClosing.cashDifferencePaise,
      closedAt: dailyClosing.closedAt,
      voidedAt: dailyClosing.voidedAt,
    })
    .from(dailyClosing)
    .innerJoin(branch, eq(branch.id, dailyClosing.branchId))
    .where(
      and(
        eq(dailyClosing.businessId, actor.businessId),
        gte(dailyClosing.businessDate, range.from),
        sql`${dailyClosing.businessDate} <= ${range.to}`,
        branches ? sql`${dailyClosing.branchId} in ${branches}` : undefined,
      ),
    )
    .orderBy(desc(dailyClosing.businessDate))

  return {
    name: 'reconciliation',
    title: 'Daily reconciliation',
    subtitle: `${range.from} to ${range.to} · as signed off`,
    columns: [
      { key: 'businessDate', header: 'Day' },
      { key: 'branchName', header: 'Branch' },
      { key: 'expectedCashPaise', header: 'Expected', money: true, align: 'right' },
      { key: 'countedCashPaise', header: 'Counted', money: true, align: 'right' },
      { key: 'cashDifferencePaise', header: 'Difference', money: true, align: 'right' },
      { key: 'state', header: 'State' },
    ],
    rows: rows.map((r) => ({
      ...r,
      state: r.voidedAt ? 'Reopened' : r.cashDifferencePaise === 0n ? 'Matched' : 'Differed',
    })),
  }
}

/* ------------------------------------------------- branch comparison ----- */

async function branchReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      branchName: branch.name,
      orders: sql<string>`count(*)`,
      revenuePaise: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      taxPaise: sql<string>`coalesce(sum(${sale.taxPaise}), 0)`,
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(
      and(
        eq(sale.businessId, actor.businessId),
        gte(sale.soldAt, from),
        lt(sale.soldAt, to),
        sql`${sale.status} <> 'VOIDED'`,
        branches ? sql`${sale.branchId} in ${branches}` : undefined,
      ),
    )
    .groupBy(branch.name)
    .orderBy(desc(sql`coalesce(sum(${sale.totalPaise}), 0)`))

  return {
    name: 'branch-comparison',
    title: 'Branch comparison',
    subtitle: `${range.from} to ${range.to}`,
    columns: [
      { key: 'branchName', header: 'Branch' },
      { key: 'orders', header: 'Bills', align: 'right' },
      { key: 'revenuePaise', header: 'Revenue', money: true, align: 'right' },
      { key: 'taxPaise', header: 'Tax', money: true, align: 'right' },
    ],
    rows: rows.map((r) => ({
      branchName: r.branchName,
      orders: Number(r.orders),
      revenuePaise: BigInt(r.revenuePaise),
      taxPaise: BigInt(r.taxPaise),
    })),
  }
}

/* --------------------------------------------------- people (FR-33.3) --- */

/**
 * The customer and supplier lists, with what each is worth and what they owe.
 *
 * FR-33.3 asks for these by name, and they are the two exports a shop reaches
 * for outside reporting: a list to call, and a list to pay. The trade columns
 * are for the period chosen; what is owed is what is owed *now*, because a
 * historical balance is a different question and mixing the two silently
 * would be worse than not offering it.
 */
async function customersReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      name: customer.name,
      phone: customer.phone,
      city: customer.city,
      gstin: customer.gstin,
      status: customer.status,
      bills: sql<string>`count(distinct ${sale.id})`,
      boughtPaise: sql<string>`coalesce(sum(${sale.totalPaise}), 0)`,
      lastBoughtAt: sql<Date | null>`max(${sale.soldAt})`,
    })
    .from(customer)
    .leftJoin(
      sale,
      and(
        eq(sale.customerId, customer.id),
        gte(sale.soldAt, from),
        lt(sale.soldAt, to),
        sql`${sale.status} <> 'VOIDED'`,
        branches ? sql`${sale.branchId} in ${branches}` : undefined,
      ),
    )
    .where(eq(customer.businessId, actor.businessId))
    .groupBy(customer.id, customer.name, customer.phone, customer.city, customer.gstin, customer.status)
    .orderBy(desc(sql`coalesce(sum(${sale.totalPaise}), 0)`), asc(customer.name))

  const dues = await customerDues(actor, { page: 1, pageSize: 5000 })
  const owed = new Map(dues.rows.map((r) => [r.customerName, r.balancePaise]))

  return {
    name: 'customers',
    title: 'Customers',
    subtitle: `Trade from ${range.from} to ${range.to}; balances as they stand now`,
    columns: [
      { key: 'name', header: 'Customer' },
      { key: 'phone', header: 'Phone' },
      { key: 'city', header: 'City' },
      { key: 'gstin', header: 'GSTIN' },
      { key: 'bills', header: 'Bills', align: 'right' },
      { key: 'boughtPaise', header: 'Bought', money: true, align: 'right' },
      { key: 'owedPaise', header: 'Owes now', money: true, align: 'right' },
      { key: 'lastBoughtAt', header: 'Last bill' },
      { key: 'status', header: 'Status' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      phone: r.phone,
      city: r.city,
      gstin: r.gstin,
      bills: Number(r.bills),
      boughtPaise: BigInt(r.boughtPaise),
      owedPaise: owed.get(r.name) ?? 0n,
      lastBoughtAt: r.lastBoughtAt,
      status: r.status.toLowerCase(),
    })),
  }
}

async function suppliersReport(actor: AuthUser, range: Range): Promise<ExportSpec> {
  const { from, to } = windowOf(range)
  const branches = branchesFor(actor, range)

  const rows = await db
    .select({
      id: supplier.id,
      name: supplier.name,
      company: supplier.company,
      phone: supplier.phone,
      city: supplier.city,
      gstin: supplier.gstin,
      status: supplier.status,
      bills: sql<string>`count(distinct ${purchase.id})`,
      purchasedPaise: sql<string>`coalesce(sum(${purchase.totalPaise}), 0)`,
      lastPurchaseAt: sql<Date | null>`max(${purchase.purchaseDate})`,
    })
    .from(supplier)
    .leftJoin(
      purchase,
      and(
        eq(purchase.supplierId, supplier.id),
        gte(purchase.purchaseDate, from),
        lt(purchase.purchaseDate, to),
        sql`${purchase.status} = 'CONFIRMED'`,
        branches ? sql`${purchase.branchId} in ${branches}` : undefined,
      ),
    )
    .where(eq(supplier.businessId, actor.businessId))
    .groupBy(
      supplier.id,
      supplier.name,
      supplier.company,
      supplier.phone,
      supplier.city,
      supplier.gstin,
      supplier.status,
    )
    .orderBy(desc(sql`coalesce(sum(${purchase.totalPaise}), 0)`), asc(supplier.name))

  // Owed now, straight from the ledger that decides it everywhere else.
  const balances = await db.execute<{ supplier_id: number; balance: string }>(
    sql`select supplier_id, sum(amount_paise)::text as balance
        from supplier_ledger_entry
        where business_id = ${actor.businessId}
        group by supplier_id`,
  )
  const owed = new Map(
    (balances as unknown as { supplier_id: number; balance: string }[]).map((r) => [
      Number(r.supplier_id),
      BigInt(r.balance),
    ]),
  )

  return {
    name: 'suppliers',
    title: 'Suppliers',
    subtitle: `Trade from ${range.from} to ${range.to}; balances as they stand now`,
    columns: [
      { key: 'name', header: 'Supplier' },
      { key: 'company', header: 'Company' },
      { key: 'phone', header: 'Phone' },
      { key: 'city', header: 'City' },
      { key: 'gstin', header: 'GSTIN' },
      { key: 'bills', header: 'Purchases', align: 'right' },
      { key: 'purchasedPaise', header: 'Purchased', money: true, align: 'right' },
      { key: 'owedPaise', header: 'Owed now', money: true, align: 'right' },
      { key: 'lastPurchaseAt', header: 'Last purchase' },
      { key: 'status', header: 'Status' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      company: r.company,
      phone: r.phone,
      city: r.city,
      gstin: r.gstin,
      bills: Number(r.bills),
      purchasedPaise: BigInt(r.purchasedPaise),
      owedPaise: owed.get(r.id) ?? 0n,
      lastPurchaseAt: r.lastPurchaseAt,
      status: r.status.toLowerCase(),
    })),
  }
}

/* --------------------------------------------------------------- entry --- */

export async function buildReport(
  actor: AuthUser,
  name: ReportName,
  range: Range,
): Promise<ExportSpec> {
  switch (name) {
    case 'sales':
      return salesReport(actor, range)
    case 'purchases':
      return purchasesReport(actor, range)
    case 'inventory':
      return inventoryReport(actor, range)
    case 'financial':
      return financialReport(actor, range)
    case 'credit':
      return creditReport(actor)
    case 'tax':
      return taxReport(actor, range)
    case 'reconciliation':
      return reconciliationReport(actor, range)
    case 'branches':
      return branchReport(actor, range)
    case 'customers':
      return customersReport(actor, range)
    case 'suppliers':
      return suppliersReport(actor, range)
  }
}
