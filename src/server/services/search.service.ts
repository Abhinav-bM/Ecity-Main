import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  brand,
  branch,
  customer,
  deviceIdentifier,
  deviceUnit,
  product,
  purchase,
  sale,
  supplier,
  type MainType,
} from '@/server/db/schema'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'

/**
 * Global search (PRD FR-30.1 – FR-30.4, FR-30.7).
 *
 * One box, one endpoint. The shape of what was typed decides where to look:
 * a 15-digit number is an IMEI, ten digits is a phone (and also a partial
 * IMEI, so both are searched), something with an @ is an email, and anything
 * else is a name.
 *
 * Every branch of this runs inside the caller's branch scope. Search is the
 * easiest place in an application to leak the thing every other screen is
 * careful about, because it touches every table at once.
 */

export type SearchKind = 'device' | 'product' | 'customer' | 'supplier' | 'sale' | 'purchase'

export type SearchHit = {
  kind: SearchKind
  id: number
  /** What the row is called. */
  title: string
  subtitle: string | null
  href: string
  /** Devices only, so the palette can show the classification. */
  mainType?: MainType
  isNewCut?: boolean
  status?: string
}

export type SearchResults = {
  query: string
  /**
   * Exactly one unambiguous match - a full IMEI, or an invoice number. The
   * palette navigates straight there rather than making someone click a list
   * of one (FR-30.5).
   */
  direct: SearchHit | null
  groups: { kind: SearchKind; label: string; hits: SearchHit[] }[]
  total: number
}

const PER_GROUP = 6

/** An IMEI is 15 digits; serials vary, so accept a plausible band. */
const FULL_IDENTIFIER = /^[0-9]{14,17}$/
const DIGITS_ONLY = /^[0-9]+$/
const LOOKS_LIKE_EMAIL = /@/
/** INV/MAIN/2026/000123, PUR-2026-0001, and anything else with a separator. */
const LOOKS_LIKE_DOCUMENT = /^[A-Za-z]{2,}[-/]/

function like(term: string) {
  return `%${term}%`
}

/**
 * Which branches the caller may see, as a SQL fragment, or null for everyone.
 * Written once because five queries need exactly the same rule.
 */
function scopeOf(actor: AuthUser): number[] | null {
  return branchScope(actor, null)
}

/* -------------------------------------------------------------- devices - */

async function searchDevices(
  actor: AuthUser,
  term: string,
  exact: boolean,
): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'inventory.view')) return []

  const scope = scopeOf(actor)
  const conditions: SQL[] = [eq(deviceUnit.businessId, actor.businessId)]
  if (scope !== null) {
    conditions.push(sql`${deviceUnit.currentBranchId} in ${scope.length ? scope : [-1]}`)
  }

  /*
   * FR-30.5. The match runs against device_identifier, not the cached
   * primary on device_unit - so the second or third IMEI of a dual-SIM
   * handset finds the same device as the first one.
   */
  const match = exact
    ? eq(deviceIdentifier.value, term)
    : or(
        sql`${deviceIdentifier.value} ilike ${like(term)}`,
        sql`${product.name} ilike ${like(term)}`,
      )!
  conditions.push(match)

  const rows = await db
    .selectDistinctOn([deviceUnit.id], {
      id: deviceUnit.id,
      identifier: deviceUnit.primaryIdentifier,
      productName: product.name,
      brandName: brand.name,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      status: deviceUnit.status,
      branchName: branch.name,
    })
    .from(deviceIdentifier)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceIdentifier.deviceId))
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
    .where(and(...conditions))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'device' as const,
    id: r.id,
    title: r.identifier ?? `Device #${r.id}`,
    subtitle: [r.brandName, r.productName, r.branchName].filter(Boolean).join(' · ') || null,
    href: `/devices/${r.id}`,
    mainType: r.mainType,
    isNewCut: r.isNewCut,
    status: r.status,
  }))
}

/* ------------------------------------------------------------- products - */

async function searchProducts(actor: AuthUser, term: string): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'product.view')) return []

  // FR-30.3. Products are business-wide; stock per branch is on the page.
  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      brandName: brand.name,
    })
    .from(product)
    .leftJoin(brand, eq(brand.id, product.brandId))
    .where(
      and(
        eq(product.businessId, actor.businessId),
        or(
          sql`${product.name} ilike ${like(term)}`,
          sql`${product.sku} ilike ${like(term)}`,
          sql`${product.barcode} ilike ${like(term)}`,
        ),
      ),
    )
    .orderBy(asc(product.name))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'product' as const,
    id: r.id,
    title: r.name,
    subtitle: [r.brandName, r.sku].filter(Boolean).join(' · ') || null,
    href: `/products/${r.id}`,
  }))
}

/* ------------------------------------------------------------ customers - */

/**
 * FR-30.7 against FR-6.7.
 *
 * A customer record is business-wide on purpose - their spend has to be
 * visible wherever they walk in. But a branch-limited user must not be able to
 * pull up someone who only ever traded at a branch they cannot see, so
 * visibility follows the trade: reachable if they have bought at a branch this
 * user can see, or if they have not bought anywhere yet and so belong to
 * nobody in particular.
 */
async function searchCustomers(actor: AuthUser, term: string): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'customer.view')) return []

  const scope = scopeOf(actor)
  const conditions: SQL[] = [
    eq(customer.businessId, actor.businessId),
    or(
      sql`${customer.name} ilike ${like(term)}`,
      sql`${customer.phone} ilike ${like(term)}`,
      sql`${customer.altPhone} ilike ${like(term)}`,
      sql`${customer.email} ilike ${like(term)}`,
    )!,
  ]

  if (scope !== null) {
    const ids = scope.length ? scope : [-1]
    conditions.push(sql`(
      exists (select 1 from sale s
              where s.customer_id = "customer"."id" and s.branch_id in ${ids})
      or not exists (select 1 from sale s where s.customer_id = "customer"."id")
    )`)
  }

  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      city: customer.city,
    })
    .from(customer)
    .where(and(...conditions))
    .orderBy(asc(customer.name))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'customer' as const,
    id: r.id,
    title: r.name,
    subtitle: [r.phone, r.email, r.city].filter(Boolean).join(' · ') || null,
    href: `/customers/${r.id}`,
  }))
}

/* ------------------------------------------------------------ suppliers - */

async function searchSuppliers(actor: AuthUser, term: string): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'supplier.view')) return []

  // Suppliers are shared across every branch by design (M1), so no scope here.
  const rows = await db
    .select({
      id: supplier.id,
      name: supplier.name,
      company: supplier.company,
      phone: supplier.phone,
      email: supplier.email,
    })
    .from(supplier)
    .where(
      and(
        eq(supplier.businessId, actor.businessId),
        or(
          sql`${supplier.name} ilike ${like(term)}`,
          sql`${supplier.company} ilike ${like(term)}`,
          sql`${supplier.phone} ilike ${like(term)}`,
          sql`${supplier.email} ilike ${like(term)}`,
        ),
      ),
    )
    .orderBy(asc(supplier.name))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'supplier' as const,
    id: r.id,
    title: r.name,
    subtitle: [r.company, r.phone, r.email].filter(Boolean).join(' · ') || null,
    href: `/suppliers/${r.id}`,
  }))
}

/* ------------------------------------------------------------ documents - */

async function searchSales(actor: AuthUser, term: string): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'sale.view')) return []

  const scope = scopeOf(actor)
  const conditions: SQL[] = [
    eq(sale.businessId, actor.businessId),
    sql`${sale.invoiceNumber} ilike ${like(term)}`,
  ]
  if (scope !== null) {
    conditions.push(sql`${sale.branchId} in ${scope.length ? scope : [-1]}`)
  }

  const rows = await db
    .select({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt,
      customerName: customer.name,
      branchName: branch.name,
    })
    .from(sale)
    .leftJoin(customer, eq(customer.id, sale.customerId))
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(and(...conditions))
    .orderBy(desc(sale.soldAt))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'sale' as const,
    id: r.id,
    title: r.invoiceNumber,
    subtitle: [r.customerName ?? 'Walk-in', r.branchName].filter(Boolean).join(' · '),
    href: `/sales/${r.id}`,
  }))
}

async function searchPurchases(actor: AuthUser, term: string): Promise<SearchHit[]> {
  if (!hasPermission(actor, 'purchase.view')) return []

  const scope = scopeOf(actor)
  const conditions: SQL[] = [
    eq(purchase.businessId, actor.businessId),
    or(
      sql`${purchase.purchaseNumber} ilike ${like(term)}`,
      sql`${purchase.supplierInvoiceNumber} ilike ${like(term)}`,
    )!,
  ]
  if (scope !== null) {
    conditions.push(sql`${purchase.branchId} in ${scope.length ? scope : [-1]}`)
  }

  const rows = await db
    .select({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      supplierName: supplier.name,
    })
    .from(purchase)
    .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
    .where(and(...conditions))
    .orderBy(desc(purchase.purchaseDate))
    .limit(PER_GROUP)

  return rows.map((r) => ({
    kind: 'purchase' as const,
    id: r.id,
    title: r.purchaseNumber,
    subtitle: r.supplierName,
    href: `/purchases/${r.id}`,
  }))
}

/* ---------------------------------------------------------------- entry - */

const LABEL: Record<SearchKind, string> = {
  device: 'Devices',
  product: 'Products',
  customer: 'Customers',
  supplier: 'Suppliers',
  sale: 'Invoices',
  purchase: 'Purchases',
}

export async function globalSearch(actor: AuthUser, raw: string): Promise<SearchResults> {
  const query = raw.trim()
  if (query.length < 2) return { query, direct: null, groups: [], total: 0 }

  const digits = DIGITS_ONLY.test(query)
  const full = FULL_IDENTIFIER.test(query)

  /*
   * A complete identifier is unambiguous: go straight to the device rather
   * than showing a list of one (FR-30.5). Anything else searches broadly and
   * lets the person choose.
   */
  if (full) {
    const exact = await searchDevices(actor, query, true)
    if (exact.length === 1) {
      return {
        query,
        direct: exact[0]!,
        groups: [{ kind: 'device', label: LABEL.device, hits: exact }],
        total: 1,
      }
    }
  }

  /*
   * What to look in. Ten digits is a phone number AND a partial IMEI, so both
   * are searched - guessing wrong there means a counter assistant with a
   * customer in front of them gets nothing.
   */
  const wanted: SearchKind[] = digits
    ? ['device', 'customer', 'supplier']
    : LOOKS_LIKE_EMAIL.test(query)
      ? ['customer', 'supplier']
      : LOOKS_LIKE_DOCUMENT.test(query)
        ? ['sale', 'purchase', 'device', 'product']
        : ['product', 'customer', 'supplier', 'device', 'sale', 'purchase']

  const [devices, products, customers, suppliers, sales, purchases] = await Promise.all([
    wanted.includes('device') ? searchDevices(actor, query, false) : [],
    wanted.includes('product') ? searchProducts(actor, query) : [],
    wanted.includes('customer') ? searchCustomers(actor, query) : [],
    wanted.includes('supplier') ? searchSuppliers(actor, query) : [],
    wanted.includes('sale') ? searchSales(actor, query) : [],
    wanted.includes('purchase') ? searchPurchases(actor, query) : [],
  ])

  const byKind: Record<SearchKind, SearchHit[]> = {
    device: devices,
    product: products,
    customer: customers,
    supplier: suppliers,
    sale: sales,
    purchase: purchases,
  }

  const groups = wanted
    .map((kind) => ({ kind, label: LABEL[kind], hits: byKind[kind] }))
    .filter((g) => g.hits.length > 0)

  const total = groups.reduce((n, g) => n + g.hits.length, 0)

  /*
   * An invoice number that matched exactly one document is as unambiguous as
   * a full IMEI, so it gets the same treatment.
   */
  const documents = [...sales, ...purchases]
  const direct =
    total === 1 && documents.length === 1 && LOOKS_LIKE_DOCUMENT.test(query)
      ? documents[0]!
      : null

  return { query, direct, groups, total }
}
