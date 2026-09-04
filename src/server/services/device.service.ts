import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  brand,
  branch,
  deviceEvent,
  deviceIdentifier,
  deviceUnit,
  product,
  supplier,
  type DeviceStatus,
  type MainType,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { appendDeviceEvent, defaultSalesChannel } from './stock.service'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'

/**
 * Device units - one row per physical handset (PRD §5.3, FR-4.3 - FR-4.12).
 *
 * The rule that shapes this file: a device's IMEIs are a LIST. Every function
 * takes and returns `imeis: string[]`, whatever the UI currently shows.
 */

export type DeviceInput = {
  productId: number
  imeis: string[]
  mainType: MainType
  isNewCut?: boolean
  newCutNotes?: string
  variant?: string
  ram?: string
  storage?: string
  colour?: string
  purchasePricePaise?: bigint | null
  sellingPricePaise?: bigint | null
  taxRateId?: number | null
  supplierId?: number | null
  purchaseDate?: Date | null
  warrantyMonths?: number | null
  branchId: number
  salesChannel?: 'ECITY' | 'EXTERNAL' | 'BOTH'
  source?: 'ECITY' | 'LEGACY'
  notes?: string
}

/** PRD FR-5.2: NEW CUT belongs to GLOBAL and nowhere else. */
export function assertClassificationValid(input: {
  mainType: MainType
  isNewCut?: boolean
  newCutNotes?: string
}) {
  if (input.isNewCut && input.mainType !== 'GLOBAL') {
    throw new AppError(
      'NEW CUT applies only to GLOBAL devices. It is a designation inside GLOBAL, not a separate type.',
      422,
      'NEW_CUT_NOT_GLOBAL',
    )
  }
  if (input.newCutNotes?.trim() && !input.isNewCut) {
    throw new AppError('NEW CUT details require the device to be marked NEW CUT.', 422, 'NEW_CUT_NOTES')
  }
}

export function normaliseImeis(imeis: string[]): string[] {
  const cleaned = imeis.map((i) => i.replace(/[\s-]/g, '').trim()).filter(Boolean)
  if (cleaned.length === 0) throw new AppError('At least one IMEI is required.', 422, 'NO_IMEI')

  for (const imei of cleaned) {
    if (!/^[0-9]{14,17}$/.test(imei)) {
      throw new AppError(`"${imei}" is not a valid IMEI — expected 14 to 17 digits.`, 422, 'BAD_IMEI')
    }
  }

  const unique = new Set(cleaned)
  if (unique.size !== cleaned.length) {
    throw new AppError('The same IMEI was entered twice for this device.', 422, 'DUPLICATE_IMEI')
  }
  return cleaned
}

/**
 * Duplicate detection across EVERY identifier of every device, not just
 * primaries (PRD FR-4.9). The message names the conflicting device so staff
 * can go and look at it.
 */
async function assertImeisFree(imeis: string[], excludeDeviceId?: number, tx: DbOrTx = db) {
  const clashes = await tx
    .select({
      imei: deviceIdentifier.imei,
      deviceId: deviceIdentifier.deviceId,
      primaryImei: deviceUnit.primaryImei,
      productName: product.name,
    })
    .from(deviceIdentifier)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceIdentifier.deviceId))
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .where(inArray(deviceIdentifier.imei, imeis))

  for (const clash of clashes) {
    if (clash.deviceId === excludeDeviceId) continue
    throw conflict(
      `IMEI ${clash.imei} already belongs to ${clash.productName} (${clash.primaryImei ?? `device #${clash.deviceId}`}).`,
      { imei: clash.imei, deviceId: clash.deviceId },
    )
  }
}

export async function createDevice(
  actor: AuthUser,
  ctx: AuditContext,
  input: DeviceInput,
  tx?: DbOrTx,
): Promise<{ id: number; primaryImei: string }> {
  assertClassificationValid(input)
  const imeis = normaliseImeis(input.imeis)

  const run = async (t: DbOrTx) => {
    await assertImeisFree(imeis, undefined, t)

    const warrantyExpiresAt =
      input.warrantyMonths && input.purchaseDate
        ? new Date(
            new Date(input.purchaseDate).setMonth(
              new Date(input.purchaseDate).getMonth() + input.warrantyMonths,
            ),
          )
        : null

    const created = (
      await t
        .insert(deviceUnit)
        .values({
          businessId: actor.businessId,
          productId: input.productId,
          primaryImei: imeis[0]!,
          variant: input.variant?.trim() || null,
          ram: input.ram?.trim() || null,
          storage: input.storage?.trim() || null,
          colour: input.colour?.trim() || null,
          mainType: input.mainType,
          isNewCut: input.isNewCut ?? false,
          newCutNotes: input.newCutNotes?.trim() || null,
          purchasePricePaise: input.purchasePricePaise ?? null,
          sellingPricePaise: input.sellingPricePaise ?? null,
          taxRateId: input.taxRateId ?? null,
          supplierId: input.supplierId ?? null,
          purchaseDate: input.purchaseDate ?? null,
          warrantyMonths: input.warrantyMonths ?? null,
          warrantyExpiresAt,
          currentBranchId: input.branchId,
          status: 'IN_STOCK',
          salesChannel: input.salesChannel ?? defaultSalesChannel(input.mainType),
          source: input.source ?? 'ECITY',
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning()
    )[0]!

    // Every identifier is a row. Slot 1 is primary by convention.
    await t.insert(deviceIdentifier).values(
      imeis.map((imei, i) => ({
        deviceId: created.id,
        imei,
        slot: i + 1,
        isPrimary: i === 0,
      })),
    )

    await appendDeviceEvent(
      { businessId: actor.businessId, actorId: actor.id, refType: ctx.branchId ? 'manual' : undefined },
      {
        deviceId: created.id,
        eventType: 'PURCHASED',
        branchId: input.branchId,
        payload: {
          mainType: input.mainType,
          isNewCut: input.isNewCut ?? false,
          imeis,
          source: input.source ?? 'ECITY',
        },
      },
      t,
    )

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'device_unit',
        entityId: created.id,
        summary: `Registered ${input.mainType} device ${imeis[0]}`,
      },
      t,
    )

    return { id: created.id, primaryImei: imeis[0]! }
  }

  return tx ? run(tx) : db.transaction(run)
}

/* ------------------------------------------------------------ querying --- */

export type DeviceFilters = {
  search?: string
  branchId?: number
  mainType?: MainType
  /** 'NEW_CUT' = GLOBAL and new cut; 'PLAIN' = GLOBAL but not (FR-5.4). */
  globalVariant?: 'NEW_CUT' | 'PLAIN'
  status?: DeviceStatus
  categoryId?: number
  brandId?: number
  productId?: number
  supplierId?: number
  salesChannel?: 'ECITY' | 'EXTERNAL' | 'BOTH'
  page: number
  pageSize: number
}

export async function listDevices(actor: AuthUser, filters: DeviceFilters) {
  const conditions: SQL[] = [eq(deviceUnit.businessId, actor.businessId)]

  // Branch scope is applied here, not trusted from the caller.
  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(scope.length > 0 ? inArray(deviceUnit.currentBranchId, scope) : sql`false`)
  }

  if (filters.mainType) conditions.push(eq(deviceUnit.mainType, filters.mainType))
  if (filters.globalVariant) {
    conditions.push(eq(deviceUnit.mainType, 'GLOBAL'))
    conditions.push(eq(deviceUnit.isNewCut, filters.globalVariant === 'NEW_CUT'))
  }
  if (filters.status) conditions.push(eq(deviceUnit.status, filters.status))
  if (filters.brandId) conditions.push(eq(product.brandId, filters.brandId))
  if (filters.categoryId) conditions.push(eq(product.categoryId, filters.categoryId))
  if (filters.productId) conditions.push(eq(deviceUnit.productId, filters.productId))
  if (filters.supplierId) conditions.push(eq(deviceUnit.supplierId, filters.supplierId))
  if (filters.salesChannel) conditions.push(eq(deviceUnit.salesChannel, filters.salesChannel))

  // Search matches ANY identifier, not only the primary one (FR-4.12).
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().replace(/[\s-]/g, '')}%`
    conditions.push(
      or(
        ilike(deviceUnit.primaryImei, term),
        ilike(product.name, `%${filters.search.trim()}%`),
        sql`exists (
          select 1 from ${deviceIdentifier}
          where ${deviceIdentifier.deviceId} = ${deviceUnit.id}
            and ${deviceIdentifier.imei} ilike ${term}
        )`,
      )!,
    )
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize
  const showCost = hasPermission(actor, 'inventory.view_cost')

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: deviceUnit.id,
        primaryImei: deviceUnit.primaryImei,
        productName: product.name,
        brandName: brand.name,
        variant: deviceUnit.variant,
        storage: deviceUnit.storage,
        colour: deviceUnit.colour,
        mainType: deviceUnit.mainType,
        isNewCut: deviceUnit.isNewCut,
        status: deviceUnit.status,
        salesChannel: deviceUnit.salesChannel,
        branchName: branch.name,
        branchCode: branch.code,
        supplierName: supplier.name,
        sellingPricePaise: deviceUnit.sellingPricePaise,
        // Cost is withheld from users without the permission (PRD §4).
        purchasePricePaise: showCost ? deviceUnit.purchasePricePaise : sql<null>`null`,
        createdAt: deviceUnit.createdAt,
      })
      .from(deviceUnit)
      .innerJoin(product, eq(product.id, deviceUnit.productId))
      .leftJoin(brand, eq(brand.id, product.brandId))
      .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
      .leftJoin(supplier, eq(supplier.id, deviceUnit.supplierId))
      .where(where)
      .orderBy(desc(deviceUnit.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ n: count() })
      .from(deviceUnit)
      .innerJoin(product, eq(product.id, deviceUnit.productId))
      .where(where),
  ])

  return { rows, total: totals[0]?.n ?? 0, page: filters.page, pageSize: filters.pageSize }
}

/** Resolve a device by ANY of its identifiers (PRD FR-30.5). */
export async function findDeviceByImei(actor: AuthUser, imei: string) {
  const clean = imei.replace(/[\s-]/g, '').trim()
  const rows = await db
    .select({ deviceId: deviceIdentifier.deviceId })
    .from(deviceIdentifier)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceIdentifier.deviceId))
    .where(and(eq(deviceIdentifier.imei, clean), eq(deviceUnit.businessId, actor.businessId)))
    .limit(1)
  return rows[0]?.deviceId ?? null
}

export async function getDevice(actor: AuthUser, id: number) {
  const rows = await db
    .select({
      device: deviceUnit,
      productName: product.name,
      brandName: brand.name,
      branchName: branch.name,
      supplierName: supplier.name,
    })
    .from(deviceUnit)
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .leftJoin(brand, eq(brand.id, product.brandId))
    .leftJoin(branch, eq(branch.id, deviceUnit.currentBranchId))
    .leftJoin(supplier, eq(supplier.id, deviceUnit.supplierId))
    .where(and(eq(deviceUnit.id, id), eq(deviceUnit.businessId, actor.businessId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('Device')

  // Enforce branch scope on a direct fetch too, not just on the list.
  const scope = branchScope(actor, null)
  if (scope !== null && row.device.currentBranchId && !scope.includes(row.device.currentBranchId)) {
    throw notFound('Device')
  }

  const [identifiers, events] = await Promise.all([
    db
      .select()
      .from(deviceIdentifier)
      .where(eq(deviceIdentifier.deviceId, id))
      .orderBy(asc(deviceIdentifier.slot)),
    db
      .select()
      .from(deviceEvent)
      .where(eq(deviceEvent.deviceId, id))
      .orderBy(asc(deviceEvent.seq)),
  ])

  const showCost = hasPermission(actor, 'inventory.view_cost')
  return {
    ...row,
    device: { ...row.device, purchasePricePaise: showCost ? row.device.purchasePricePaise : null },
    identifiers,
    events,
  }
}

/** Counts for the five main types, with GLOBAL split by NEW CUT (FR-5.4). */
export async function mainTypeSummary(actor: AuthUser, branchId?: number | null) {
  const conditions: SQL[] = [
    eq(deviceUnit.businessId, actor.businessId),
    eq(deviceUnit.status, 'IN_STOCK'),
  ]
  const scope = branchScope(actor, branchId ?? null)
  if (scope !== null) {
    conditions.push(scope.length > 0 ? inArray(deviceUnit.currentBranchId, scope) : sql`false`)
  }

  return db
    .select({
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      units: count(),
    })
    .from(deviceUnit)
    .where(and(...conditions))
    .groupBy(deviceUnit.mainType, deviceUnit.isNewCut)
    .orderBy(asc(deviceUnit.mainType))
}
