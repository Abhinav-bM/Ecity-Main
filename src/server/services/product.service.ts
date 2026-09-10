import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  brand,
  branch,
  branchStock,
  category,
  deviceUnit,
  product,
  taxRate,
} from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'

/* ------------------------------------------------ categories and brands --- */

export async function listCategories(actor: AuthUser) {
  return db
    .select()
    .from(category)
    .where(eq(category.businessId, actor.businessId))
    .orderBy(asc(category.sortOrder), asc(category.name))
}

export async function listBrands(actor: AuthUser) {
  return db
    .select()
    .from(brand)
    .where(eq(brand.businessId, actor.businessId))
    .orderBy(asc(brand.name))
}

export async function createCategory(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    name: string
    isSerialised: boolean
    /** IMEI for phones, SERIAL for laptops and other electronics. */
    identifierType?: 'IMEI' | 'SERIAL' | 'NONE'
    /** Whether a phone also carries the serial printed on its box. */
    capturesSerial?: boolean
  },
) {
  const clash = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.businessId, actor.businessId), eq(category.name, input.name)))
    .limit(1)
  if (clash[0]) throw conflict('A category with this name already exists.')

  const created = (
    await db
      .insert(category)
      .values({
        businessId: actor.businessId,
        name: input.name,
        isSerialised: input.isSerialised,
        // A counted category has no identifier; a serialised one defaults to
        // IMEI unless it is told otherwise.
        identifierType: input.isSerialised ? (input.identifierType ?? 'IMEI') : 'NONE',
        // Only an IMEI category can also want a serial: on a serial-only one
        // the serial IS the identifier, and on a counted one there is no unit
        // to carry it.
        capturesSerial:
          input.isSerialised && (input.identifierType ?? 'IMEI') === 'IMEI'
            ? (input.capturesSerial ?? false)
            : false,
      })
      .returning()
  )[0]!
  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'category',
    entityId: created.id,
    summary: `Created category ${created.name}${created.isSerialised ? ` (${created.identifierType}-tracked)` : ''}`,
  })
  return { id: created.id }
}

export async function createBrand(actor: AuthUser, ctx: AuditContext, input: { name: string }) {
  const clash = await db
    .select({ id: brand.id })
    .from(brand)
    .where(and(eq(brand.businessId, actor.businessId), eq(brand.name, input.name)))
    .limit(1)
  if (clash[0]) throw conflict('A brand with this name already exists.')

  const created = (
    await db.insert(brand).values({ businessId: actor.businessId, name: input.name }).returning()
  )[0]!
  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'brand',
    entityId: created.id,
    summary: `Created brand ${created.name}`,
  })
  return { id: created.id }
}

/* -------------------------------------------------------------- products --- */

export type ProductInput = {
  name: string
  categoryId: number
  brandId?: number | null
  model?: string
  sku?: string
  barcode?: string
  /** HSN/SAC, printed on every statutory invoice (PRD OQ-4). */
  hsnCode?: string
  description?: string
  defaultPurchasePricePaise?: bigint | null
  defaultSellingPricePaise?: bigint | null
  taxRateId?: number | null
  defaultSupplierId?: number | null
}

async function resolveCategory(actor: AuthUser, categoryId: number) {
  const rows = await db
    .select()
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw new AppError('That category does not exist.', 422, 'INVALID_CATEGORY')
  return row
}

async function assertSkuFree(businessId: number, sku: string | null, excludeId?: number) {
  if (!sku) return
  const found = await db
    .select({ id: product.id, name: product.name })
    .from(product)
    .where(and(eq(product.businessId, businessId), eq(product.sku, sku)))
    .limit(1)
  if (found[0] && found[0].id !== excludeId) {
    throw conflict(`SKU ${sku} already belongs to ${found[0].name}.`)
  }
}

export async function createProduct(actor: AuthUser, ctx: AuditContext, input: ProductInput) {
  const cat = await resolveCategory(actor, input.categoryId)
  const sku = input.sku?.trim().toUpperCase() || null
  await assertSkuFree(actor.businessId, sku)

  const created = (
    await db
      .insert(product)
      .values({
        businessId: actor.businessId,
        name: input.name.trim(),
        categoryId: input.categoryId,
        brandId: input.brandId ?? null,
        model: input.model?.trim() || null,
        sku,
        barcode: input.barcode?.trim() || null,
        hsnCode: input.hsnCode?.trim() || null,
        description: input.description?.trim() || null,
        defaultPurchasePricePaise: input.defaultPurchasePricePaise ?? null,
        defaultSellingPricePaise: input.defaultSellingPricePaise ?? null,
        taxRateId: input.taxRateId ?? null,
        defaultSupplierId: input.defaultSupplierId ?? null,
        // Serialisation follows the category. A mobile is never counted.
        isSerialised: cat.isSerialised,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning()
  )[0]!

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'product',
    entityId: created.id,
    summary: `Created product ${created.name}`,
    changes: diff(null, { name: created.name, sku: created.sku, categoryId: created.categoryId }),
  })
  return { id: created.id }
}

export async function updateProduct(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: ProductInput,
) {
  const before = await getProduct(actor, id)
  const cat = await resolveCategory(actor, input.categoryId)
  const sku = input.sku?.trim().toUpperCase() || null
  await assertSkuFree(actor.businessId, sku, id)

  // Changing serialisation after units exist would orphan them.
  if (before.product.isSerialised !== cat.isSerialised) {
    throw new AppError(
      'A product cannot move between IMEI-tracked and quantity-tracked categories. Create a new product instead.',
      422,
      'SERIALISATION_CHANGE',
    )
  }

  await db
    .update(product)
    .set({
      name: input.name.trim(),
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      model: input.model?.trim() || null,
      sku,
      barcode: input.barcode?.trim() || null,
      hsnCode: input.hsnCode?.trim() || null,
      description: input.description?.trim() || null,
      defaultPurchasePricePaise: input.defaultPurchasePricePaise ?? null,
      defaultSellingPricePaise: input.defaultSellingPricePaise ?? null,
      taxRateId: input.taxRateId ?? null,
      defaultSupplierId: input.defaultSupplierId ?? null,
      updatedAt: new Date(),
      updatedBy: actor.id,
    })
    .where(eq(product.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'product',
    entityId: id,
    summary: `Updated product ${input.name}`,
    changes: diff(before.product, { name: input.name.trim(), sku }),
  })
}

/** PRD FR-4.2 — a product carries one image. */
export async function setProductImage(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  imageUrl: string | null,
) {
  const before = await getProduct(actor, id)
  await db.update(product).set({ imageUrl, updatedAt: new Date() }).where(eq(product.id, id))
  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'product',
    entityId: id,
    summary: imageUrl
      ? `Set image for ${before.product.name}`
      : `Removed image from ${before.product.name}`,
  })
}

export async function setProductActive(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  isActive: boolean,
) {
  const before = await getProduct(actor, id)
  await db.update(product).set({ isActive, updatedAt: new Date() }).where(eq(product.id, id))
  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'product',
    entityId: id,
    summary: `${isActive ? 'Reactivated' : 'Deactivated'} ${before.product.name}`,
  })
}

export async function getProduct(actor: AuthUser, id: number) {
  const rows = await db
    .select({
      product,
      categoryName: category.name,
      brandName: brand.name,
      taxRateName: taxRate.name,
    })
    .from(product)
    .innerJoin(category, eq(category.id, product.categoryId))
    .leftJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(taxRate, eq(taxRate.id, product.taxRateId))
    .where(and(eq(product.id, id), eq(product.businessId, actor.businessId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('Product')

  // Serialised products hold no branch_stock rows - their per-branch count is
  // how many units are still IN_STOCK there.
  const stock = row.product.isSerialised
    ? await db
        .select({
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          quantity: count(),
          minQuantity: sql<number>`0`,
        })
        .from(deviceUnit)
        .innerJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
        .where(and(eq(deviceUnit.productId, id), eq(deviceUnit.status, 'IN_STOCK')))
        .groupBy(branch.id, branch.name, branch.code)
        .orderBy(asc(branch.name))
    : await db
        .select({
          branchId: branchStock.branchId,
          branchName: branch.name,
          branchCode: branch.code,
          quantity: branchStock.quantity,
          minQuantity: branchStock.minQuantity,
        })
        .from(branchStock)
        .innerJoin(branch, eq(branch.id, branchStock.branchId))
        .where(eq(branchStock.productId, id))
        .orderBy(asc(branch.name))

  const showCost = hasPermission(actor, 'inventory.view_cost')
  return {
    ...row,
    product: {
      ...row.product,
      defaultPurchasePricePaise: showCost ? row.product.defaultPurchasePricePaise : null,
    },
    stock,
  }
}

export type ProductFilters = {
  search?: string
  categoryId?: number
  brandId?: number
  branchId?: number
  serialised?: boolean
  lowStockOnly?: boolean
  includeInactive?: boolean
  page: number
  pageSize: number
}

export async function listProducts(actor: AuthUser, filters: ProductFilters) {
  const conditions: SQL[] = [eq(product.businessId, actor.businessId)]
  if (!filters.includeInactive) conditions.push(eq(product.isActive, true))
  if (filters.categoryId) conditions.push(eq(product.categoryId, filters.categoryId))
  if (filters.brandId) conditions.push(eq(product.brandId, filters.brandId))
  if (filters.serialised !== undefined) {
    conditions.push(eq(product.isSerialised, filters.serialised))
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      or(ilike(product.name, term), ilike(product.sku, term), ilike(product.barcode, term))!,
    )
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize
  const showCost = hasPermission(actor, 'inventory.view_cost')

  /**
   * Stock comes from two different places depending on the product:
   *   - counted products  -> the sum of their branch_stock rows
   *   - serialised ones   -> the number of device units still IN_STOCK
   *
   * A mobile never has a branch_stock row, so reading only that table would
   * report every phone in the shop as having no stock.
   *
   * Both are scalar subqueries rather than joins, so the two sources cannot
   * multiply each other into a wrong total.
   */
  const scope = branchScope(actor, filters.branchId ?? null)
  const deviceBranchCond =
    scope === null
      ? sql`true`
      : scope.length > 0
        ? inArray(deviceUnit.currentBranchId, scope)
        : sql`false`
  const stockBranchCond =
    scope === null
      ? sql`true`
      : scope.length > 0
        ? inArray(branchStock.branchId, scope)
        : sql`false`

  const quantity = sql<number>`(
    case when ${product.isSerialised} then (
      select count(*)::int from ${deviceUnit}
      where ${deviceUnit.productId} = ${product.id}
        and ${deviceUnit.status} = 'IN_STOCK'
        and ${deviceBranchCond}
    ) else (
      select coalesce(sum(${branchStock.quantity}), 0)::int from ${branchStock}
      where ${branchStock.productId} = ${product.id}
        and ${stockBranchCond}
    ) end
  )`

  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      sku: product.sku,
      model: product.model,
      categoryName: category.name,
      brandName: brand.name,
      isSerialised: product.isSerialised,
      identifierType: category.identifierType,
      capturesSerial: category.capturesSerial,
      isActive: product.isActive,
      sellingPricePaise: product.defaultSellingPricePaise,
      purchasePricePaise: showCost ? product.defaultPurchasePricePaise : sql<null>`null`,
      quantity,
    })
    .from(product)
    .innerJoin(category, eq(category.id, product.categoryId))
    .leftJoin(brand, eq(brand.id, product.brandId))
    .where(where)
    .orderBy(asc(product.name))
    .limit(filters.pageSize)
    .offset(offset)

  const totals = await db.select({ n: count() }).from(product).where(where)

  return { rows, total: totals[0]?.n ?? 0, page: filters.page, pageSize: filters.pageSize }
}

/** Products at or below their minimum for a branch (PRD FR-4.7). */
/** The columns the low-stock screen may sort by. Anything else is refused. */
export const LOW_STOCK_SORTS = ['shortfall', 'product', 'branch', 'quantity', 'minimum'] as const
export type LowStockSort = (typeof LOW_STOCK_SORTS)[number]

/**
 * Products at or below their branch minimum (PRD FR-4.7).
 *
 * Paged and sorted in the database, unlike the users and branches lists: this
 * one grows with the catalogue rather than with the payroll, and a shop that
 * has set minimums on a few thousand accessories should not be sent all of
 * them to render twenty-five.
 *
 * Sorted by shortfall by default - what is furthest below its minimum is what
 * to reorder first, which alphabetical order would bury.
 */
export async function listLowStock(
  actor: AuthUser,
  branchId?: number | null,
  query: { page?: number; pageSize?: number; sort?: LowStockSort; dir?: 'asc' | 'desc' } = {},
) {
  const scope = branchScope(actor, branchId ?? null)
  const conditions: SQL[] = [
    eq(product.businessId, actor.businessId),
    eq(product.isActive, true),
    eq(product.isSerialised, false),
    sql`${branchStock.minQuantity} > 0`,
    sql`${branchStock.quantity} <= ${branchStock.minQuantity}`,
  ]
  if (scope !== null) {
    conditions.push(scope.length > 0 ? inArray(branchStock.branchId, scope) : sql`false`)
  }

  const where = and(...conditions)
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25))
  const shortfall = sql`${branchStock.minQuantity} - ${branchStock.quantity}`

  // Never the raw string from the URL: an ORDER BY built from user input is
  // how a sort becomes an injection point.
  const column = {
    shortfall,
    product: product.name,
    branch: branch.name,
    quantity: branchStock.quantity,
    minimum: branchStock.minQuantity,
  }[query.sort ?? 'shortfall']
  const ordered = query.dir === 'asc' ? asc(column) : desc(column)

  const [rows, totals] = await Promise.all([
    db
      .select({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        branchId: branchStock.branchId,
        branchName: branch.name,
        quantity: branchStock.quantity,
        minQuantity: branchStock.minQuantity,
      })
      .from(branchStock)
      .innerJoin(product, eq(product.id, branchStock.productId))
      .innerJoin(branch, eq(branch.id, branchStock.branchId))
      .where(where)
      .orderBy(ordered)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: count() })
      .from(branchStock)
      .innerJoin(product, eq(product.id, branchStock.productId))
      .innerJoin(branch, eq(branch.id, branchStock.branchId))
      .where(where),
  ])

  return { rows, total: totals[0]?.n ?? 0, page, pageSize }
}

export async function setMinQuantity(
  actor: AuthUser,
  ctx: AuditContext,
  input: { productId: number; branchId: number; minQuantity: number },
) {
  await db
    .insert(branchStock)
    .values({
      productId: input.productId,
      branchId: input.branchId,
      quantity: 0,
      minQuantity: input.minQuantity,
    })
    .onConflictDoUpdate({
      target: [branchStock.productId, branchStock.branchId],
      set: { minQuantity: input.minQuantity, updatedAt: new Date() },
    })

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'branch_stock',
    entityId: `${input.productId}:${input.branchId}`,
    summary: `Minimum stock set to ${input.minQuantity}`,
  })
}

/* --------------------------------- M11: managing brands and categories --- */

/**
 * Rename a brand, or take it out of the pickers.
 *
 * Never deleted: a brand is referenced by products, and products by invoices
 * already issued. Deactivating hides it from new work and leaves history
 * readable, which is the same rule every other master record follows.
 */
export async function updateBrand(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: { name?: string; isActive?: boolean },
) {
  const before = (
    await db
      .select()
      .from(brand)
      .where(and(eq(brand.id, id), eq(brand.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!before) throw notFound('Brand')

  const name = input.name?.trim() ?? before.name
  if (!name) throw new AppError('A brand needs a name.', 422, 'NO_NAME')

  if (name !== before.name) {
    const clash = (
      await db
        .select({ id: brand.id })
        .from(brand)
        .where(and(eq(brand.businessId, actor.businessId), eq(brand.name, name)))
        .limit(1)
    )[0]
    if (clash) throw conflict('A brand with this name already exists.')
  }

  const values = { name, isActive: input.isActive ?? before.isActive, updatedAt: new Date() }
  await db.update(brand).set(values).where(eq(brand.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'brand',
    entityId: id,
    summary:
      values.isActive === before.isActive
        ? `Renamed brand ${before.name} to ${name}`
        : `${values.isActive ? 'Reactivated' : 'Deactivated'} brand ${name}`,
    changes: diff(before, values),
  })
}

/**
 * Rename a category, or take it out of the pickers.
 *
 * `isSerialised` and `identifierType` are NOT editable once any product uses
 * the category. They decide whether its products are tracked by IMEI, by
 * serial, or by quantity - changing that would reinterpret stock that already
 * exists, turning counted items into ones the system thinks have identifiers.
 */
export async function updateCategory(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: {
    name?: string
    isActive?: boolean
    isSerialised?: boolean
    identifierType?: 'IMEI' | 'SERIAL' | 'NONE'
    capturesSerial?: boolean
  },
) {
  const before = (
    await db
      .select()
      .from(category)
      .where(and(eq(category.id, id), eq(category.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!before) throw notFound('Category')

  const name = input.name?.trim() ?? before.name
  if (!name) throw new AppError('A category needs a name.', 422, 'NO_NAME')

  if (name !== before.name) {
    const clash = (
      await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.businessId, actor.businessId), eq(category.name, name)))
        .limit(1)
    )[0]
    if (clash) throw conflict('A category with this name already exists.')
  }

  const wantsTrackingChange =
    (input.isSerialised !== undefined && input.isSerialised !== before.isSerialised) ||
    (input.identifierType !== undefined && input.identifierType !== before.identifierType)

  if (wantsTrackingChange) {
    const inUse = (
      await db
        .select({ id: product.id })
        .from(product)
        .where(eq(product.categoryId, id))
        .limit(1)
    )[0]
    if (inUse) {
      throw conflict(
        'This category already has products, so how they are tracked cannot change. ' +
          'Create a new category instead.',
      )
    }
  }

  const isSerialised = input.isSerialised ?? before.isSerialised
  const identifierType = isSerialised ? (input.identifierType ?? before.identifierType) : 'NONE'
  const values = {
    name,
    isActive: input.isActive ?? before.isActive,
    isSerialised,
    identifierType,
    /*
     * Asking for a serial is NOT a tracking change, and is deliberately not
     * caught by the guard above. Nothing already recorded is reinterpreted by
     * it: existing handsets simply have no serial, and the next one booked in
     * gets the extra box. A shop that realises after a month that it wants
     * the serials should not have to build a second Mobiles category.
     */
    capturesSerial:
      identifierType === 'IMEI' ? (input.capturesSerial ?? before.capturesSerial) : false,
    updatedAt: new Date(),
  } as const

  await db.update(category).set(values).where(eq(category.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'category',
    entityId: id,
    summary:
      values.isActive === before.isActive
        ? `Updated category ${name}`
        : `${values.isActive ? 'Reactivated' : 'Deactivated'} category ${name}`,
    changes: diff(before, values),
  })
}

/** How many products each brand and category holds — shown before deactivating. */
export async function masterDataUsage(actor: AuthUser) {
  const [brands, categories] = await Promise.all([
    db
      .select({ id: product.brandId, n: sql<string>`count(*)` })
      .from(product)
      .where(eq(product.businessId, actor.businessId))
      .groupBy(product.brandId),
    db
      .select({ id: product.categoryId, n: sql<string>`count(*)` })
      .from(product)
      .where(eq(product.businessId, actor.businessId))
      .groupBy(product.categoryId),
  ])
  return {
    byBrand: new Map(brands.filter((b) => b.id !== null).map((b) => [b.id!, Number(b.n)])),
    byCategory: new Map(categories.map((c) => [c.id, Number(c.n)])),
  }
}
