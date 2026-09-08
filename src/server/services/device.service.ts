import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  brand,
  branch,
  business,
  category,
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
  identifiers: string[]
  mainType: MainType
  isNewCut?: boolean
  newCutNotes?: string
  variant?: string
  ram?: string
  storage?: string
  colour?: string
  batteryHealthPercent?: number | null
  purchasePricePaise?: bigint | null
  sellingPricePaise?: bigint | null
  taxRateId?: number | null
  supplierId?: number | null
  purchaseDate?: Date | null
  warrantyMonths?: number | null
  /** Who honours it (PRD FR-29.1): the brand, the shop, or a third party. */
  warrantyProvider?: string
  branchId: number
  salesChannel?: 'ECITY' | 'EXTERNAL' | 'BOTH'
  source?: 'ECITY' | 'LEGACY'
  notes?: string
  /**
   * When the handset actually arrived. Defaults to now.
   *
   * A backdated purchase must date its PURCHASED event too, or M10's movement
   * report shows the stock arriving on the wrong day - and an opening-balance
   * import (M11) would put every device on the day it was uploaded.
   */
  receivedAt?: Date
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

export type IdentifierType = 'IMEI' | 'SERIAL'

/** What to call it on screen and in error messages. */
export const IDENTIFIER_LABEL: Record<IdentifierType, string> = {
  IMEI: 'IMEI',
  SERIAL: 'serial number',
}

/**
 * Clean and validate a device's identifiers.
 *
 * A phone carries IMEIs (14-17 digits); a laptop, MacBook or speaker carries a
 * manufacturer serial (letters and digits). The classification is identical
 * for both - only the identifier differs.
 */
export function normaliseIdentifiers(
  values: string[],
  type: IdentifierType = 'IMEI',
): string[] {
  const label = IDENTIFIER_LABEL[type]
  // Serials can legitimately contain hyphens, so only strip whitespace there.
  const cleaned = values
    .map((v) => (type === 'IMEI' ? v.replace(/[\s-]/g, '') : v.replace(/\s/g, '')).trim())
    .filter(Boolean)

  if (cleaned.length === 0) {
    throw new AppError(`At least one ${label} is required.`, 422, 'NO_IDENTIFIER')
  }

  const pattern = type === 'IMEI' ? /^[0-9]{14,17}$/ : /^[A-Za-z0-9][A-Za-z0-9/-]{3,49}$/
  const expectation =
    type === 'IMEI' ? 'expected 14 to 17 digits' : 'expected 4 to 50 letters, digits or hyphens'

  for (const value of cleaned) {
    if (!pattern.test(value)) {
      throw new AppError(`"${value}" is not a valid ${label} — ${expectation}.`, 422, 'BAD_IDENTIFIER')
    }
  }

  if (new Set(cleaned).size !== cleaned.length) {
    throw new AppError(`The same ${label} was entered twice for this device.`, 422, 'DUPLICATE_IDENTIFIER')
  }
  return cleaned
}

/**
 * Duplicate detection across EVERY identifier of every device, not just
 * primaries (PRD FR-4.9). The message names the conflicting device so staff
 * can go and look at it.
 */
async function assertIdentifiersFree(
  values: string[],
  type: IdentifierType,
  excludeDeviceId?: number,
  tx: DbOrTx = db,
) {
  const clashes = await tx
    .select({
      value: deviceIdentifier.value,
      deviceId: deviceIdentifier.deviceId,
      primaryIdentifier: deviceUnit.primaryIdentifier,
      productName: product.name,
    })
    .from(deviceIdentifier)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceIdentifier.deviceId))
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .where(inArray(deviceIdentifier.value, values))

  for (const clash of clashes) {
    if (clash.deviceId === excludeDeviceId) continue
    throw conflict(
      `${IDENTIFIER_LABEL[type]} ${clash.value} already belongs to ${clash.productName} (${clash.primaryIdentifier ?? `device #${clash.deviceId}`}).`,
      { value: clash.value, deviceId: clash.deviceId },
    )
  }
}

/**
 * How this product's units are identified, taken from its category. A phone
 * category is IMEI; a laptop or speaker category is SERIAL.
 */
export async function identifierTypeForProduct(
  productId: number,
  tx: DbOrTx = db,
): Promise<IdentifierType> {
  const rows = await tx
    .select({ identifierType: category.identifierType })
    .from(product)
    .innerJoin(category, eq(category.id, product.categoryId))
    .where(eq(product.id, productId))
    .limit(1)
  const found = rows[0]?.identifierType
  if (!found || found === 'NONE') {
    // A category that is not serialised has no identifiers to give.
    throw new AppError(
      'This product is counted by quantity, not tracked individually.',
      422,
      'NOT_SERIALISED',
    )
  }
  return found
}

export async function createDevice(
  actor: AuthUser,
  ctx: AuditContext,
  input: DeviceInput,
  tx?: DbOrTx,
): Promise<{ id: number; primaryIdentifier: string }> {
  assertClassificationValid(input)

  const run = async (t: DbOrTx) => {
    // Read on the caller's transaction, so a purchase confirming many devices
    // sees one consistent answer.
    const newStockChannel =
      (
        await t
          .select({ channel: business.newStockSalesChannel })
          .from(business)
          .where(eq(business.id, actor.businessId))
          .limit(1)
      )[0]?.channel ?? 'EXTERNAL'

    const identifierType = await identifierTypeForProduct(input.productId, t)
    const identifiers = normaliseIdentifiers(input.identifiers, identifierType)
    await assertIdentifiersFree(identifiers, identifierType, undefined, t)

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
          primaryIdentifier: identifiers[0]!,
          variant: input.variant?.trim() || null,
          ram: input.ram?.trim() || null,
          storage: input.storage?.trim() || null,
          colour: input.colour?.trim() || null,
          batteryHealthPercent: input.batteryHealthPercent ?? null,
          mainType: input.mainType,
          isNewCut: input.isNewCut ?? false,
          newCutNotes: input.newCutNotes?.trim() || null,
          purchasePricePaise: input.purchasePricePaise ?? null,
          sellingPricePaise: input.sellingPricePaise ?? null,
          taxRateId: input.taxRateId ?? null,
          supplierId: input.supplierId ?? null,
          purchaseDate: input.purchaseDate ?? null,
          warrantyMonths: input.warrantyMonths ?? null,
          warrantyProvider: input.warrantyProvider?.trim() || null,
          warrantyExpiresAt,
          currentBranchId: input.branchId,
          status: 'IN_STOCK',
          salesChannel:
            input.salesChannel ?? defaultSalesChannel(input.mainType, newStockChannel),
          source: input.source ?? 'ECITY',
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning()
    )[0]!

    // Every identifier is a row. Slot 1 is primary by convention.
    await t.insert(deviceIdentifier).values(
      identifiers.map((value, i) => ({
        deviceId: created.id,
        value,
        type: identifierType,
        slot: i + 1,
        isPrimary: i === 0,
      })),
    )

    await appendDeviceEvent(
      {
        businessId: actor.businessId,
        actorId: actor.id,
        refType: ctx.branchId ? 'manual' : undefined,
        occurredAt: input.receivedAt,
      },
      {
        deviceId: created.id,
        eventType: 'PURCHASED',
        branchId: input.branchId,
        payload: {
          mainType: input.mainType,
          isNewCut: input.isNewCut ?? false,
          identifiers,
          identifierType,
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
        summary: `Registered ${input.mainType} device ${identifiers[0]}`,
      },
      t,
    )

    return { id: created.id, primaryIdentifier: identifiers[0]! }
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

  /**
   * A voided unit - one whose purchase was reversed - is not stock and would
   * only clutter the list. It stays findable when explicitly asked for, so its
   * history is never lost.
   */
  if (filters.status) conditions.push(eq(deviceUnit.status, filters.status))
  else conditions.push(sql`${deviceUnit.status} <> 'VOIDED'`)

  if (filters.mainType) conditions.push(eq(deviceUnit.mainType, filters.mainType))
  if (filters.globalVariant) {
    conditions.push(eq(deviceUnit.mainType, 'GLOBAL'))
    conditions.push(eq(deviceUnit.isNewCut, filters.globalVariant === 'NEW_CUT'))
  }
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
        ilike(deviceUnit.primaryIdentifier, term),
        ilike(product.name, `%${filters.search.trim()}%`),
        // Match ANY identifier, not only the primary one (FR-4.12).
        sql`exists (
          select 1 from ${deviceIdentifier}
          where ${deviceIdentifier.deviceId} = ${deviceUnit.id}
            and ${deviceIdentifier.value} ilike ${term}
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
        primaryIdentifier: deviceUnit.primaryIdentifier,
        productName: product.name,
        brandName: brand.name,
        variant: deviceUnit.variant,
        storage: deviceUnit.storage,
        colour: deviceUnit.colour,
        batteryHealthPercent: deviceUnit.batteryHealthPercent,
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

/** Resolve a device by ANY of its identifiers - IMEI or serial (PRD FR-30.5). */
export async function findDeviceByIdentifier(actor: AuthUser, value: string) {
  const clean = value.trim()
  const rows = await db
    .select({ deviceId: deviceIdentifier.deviceId })
    .from(deviceIdentifier)
    .innerJoin(deviceUnit, eq(deviceUnit.id, deviceIdentifier.deviceId))
    .where(
      and(
        or(
          eq(deviceIdentifier.value, clean),
          // A scanned IMEI may arrive with separators.
          eq(deviceIdentifier.value, clean.replace(/[\s-]/g, '')),
        )!,
        eq(deviceUnit.businessId, actor.businessId),
      ),
    )
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

/**
 * Correct a device after it was created (M6, raised during M5).
 *
 * Before this there was no way to fix a device at all, which meant a wrong
 * main type was permanent - and main type decides whether a handset reaches
 * the till, so one keystroke could hide sellable stock for good.
 *
 * Identifiers are deliberately not editable. Changing an IMEI is not a
 * correction, it is a different handset; the uniqueness and history rules
 * exist precisely to stop that.
 */
export type DeviceUpdateInput = {
  mainType?: MainType
  isNewCut?: boolean
  newCutNotes?: string | null
  variant?: string | null
  ram?: string | null
  storage?: string | null
  colour?: string | null
  batteryHealthPercent?: number | null
  purchasePricePaise?: bigint | null
  sellingPricePaise?: bigint | null
  taxRateId?: number | null
  supplierId?: number | null
  warrantyMonths?: number | null
  warrantyProvider?: string | null
  salesChannel?: 'ECITY' | 'EXTERNAL' | 'BOTH'
  notes?: string | null
}

export async function updateDevice(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: DeviceUpdateInput,
): Promise<void> {
  const before = (
    await db
      .select()
      .from(deviceUnit)
      .where(and(eq(deviceUnit.id, id), eq(deviceUnit.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!before) throw notFound('Device')

  // A sold or voided unit is history. Correcting it would rewrite what an
  // issued invoice says about a handset somebody already owns.
  if (['SOLD', 'SOLD_PENDING_IMPORT', 'VOIDED'].includes(before.status)) {
    throw conflict(
      `${before.primaryIdentifier ?? 'This device'} is ${before.status} and can no longer be edited.`,
    )
  }

  const next = {
    mainType: input.mainType ?? before.mainType,
    isNewCut: input.isNewCut ?? before.isNewCut,
  }
  // The same rule the create form enforces: NEW CUT belongs to GLOBAL alone.
  assertClassificationValid(next)

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.id }
  const fields = [
    'mainType', 'isNewCut', 'newCutNotes', 'variant', 'ram', 'storage', 'colour',
    'batteryHealthPercent', 'purchasePricePaise', 'sellingPricePaise', 'taxRateId',
    'supplierId', 'warrantyMonths', 'warrantyProvider', 'salesChannel', 'notes',
  ] as const

  for (const field of fields) {
    const value = input[field]
    if (value === undefined) continue
    const from = (before as Record<string, unknown>)[field]
    const to = typeof value === 'string' ? value.trim() || null : value
    if (String(from) === String(to)) continue
    /*
     * Recorded as strings. Money is bigint paise, and both the audit `changes`
     * column and the device_event payload are JSON - which cannot hold a
     * bigint at all. A string keeps the exact value; a number would not.
     */
    changes[field] = {
      from: typeof from === 'bigint' ? from.toString() : from,
      to: typeof to === 'bigint' ? to.toString() : to,
    }
    set[field] = to
  }

  if (Object.keys(changes).length === 0) return

  await db.transaction(async (tx) => {
    await tx.update(deviceUnit).set(set).where(eq(deviceUnit.id, id))

    /*
     * A device_event as well as an audit entry, so the M9 timeline shows the
     * correction as part of the handset's history rather than the record
     * silently changing underneath it.
     */
    await appendDeviceEvent(
      {
        businessId: actor.businessId,
        actorId: actor.id,
        refType: 'device_edit',
        refId: id,
      },
      {
        deviceId: id,
        eventType: 'RECLASSIFIED',
        branchId: before.currentBranchId,
        payload: changes,
      },
      tx,
    )

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'device_unit',
        entityId: id,
        summary: `Corrected ${before.primaryIdentifier ?? `#${id}`}: ${Object.keys(changes).join(', ')}`,
        changes,
      },
      tx,
    )
  })
}
