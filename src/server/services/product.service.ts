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
export async function listLowStock(actor: AuthUser, branchId?: number | null) {
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

  return db
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
    .where(and(...conditions))
    .orderBy(desc(sql`${branchStock.minQuantity} - ${branchStock.quantity}`))
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
