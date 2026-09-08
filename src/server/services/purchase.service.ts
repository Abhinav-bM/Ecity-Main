import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branch,
  deviceIdentifier,
  deviceUnit,
  product,
  purchase,
  purchaseItem,
  supplier,
  type MainType,
} from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { assertBranchAcceptsTransactions } from './branch.service'
import { assertPartySelectable } from './party.service'
import { createDevice, identifierTypeForProduct } from './device.service'
import { decreaseStock, increaseStock, setDeviceStatus } from './stock.service'
import { nextDocumentNumber } from './sequence.service'
import {
  paymentStatusFor,
  postLedgerEntry,
  purchasePaidPaise,
} from './supplier-ledger.service'

/**
 * Purchases (PRD FR-5.8 - FR-5.15).
 *
 * The rule that shapes this file: **confirming is what moves stock.** A draft
 * changes nothing, so a half-typed purchase can be abandoned safely. Confirm
 * does everything in one transaction - devices, stock, events, ledger - so a
 * purchase can never be half-recorded (docs/02 §2.2 rule 3).
 */

/**
 * One handset on a serialised line.
 *
 * Every field except the identifier is optional and falls back to the line.
 * Nine of ten pieces in a shipment are identical and the tenth is not, so the
 * line carries the batch and a unit says only how it differs. Battery health
 * has no line default on purpose - on used stock it is genuinely different on
 * every handset, and a default would be a number somebody trusted.
 */
export type PurchaseUnitInput = {
  identifier: string
  variant?: string
  ram?: string
  storage?: string
  colour?: string
  batteryHealthPercent?: number | null
}

export type PurchaseLineInput = {
  productId: number
  quantity: number
  unitCostPaise: bigint
  discountPaise?: bigint
  taxRateId?: number | null
  taxPaise?: bigint
  /** Serialised lines only. One per unit; length must equal quantity. */
  identifiers?: string[]
  /**
   * The same units, with their own specs. Supply this *or* `identifiers` -
   * `identifiers` is the short form for a batch that is uniform, and is what
   * the tests and the API use when they have nothing to vary.
   */
  units?: PurchaseUnitInput[]
  mainType?: MainType
  isNewCut?: boolean
  newCutNotes?: string
  /** Line specs, stamped onto every unit that does not override them. */
  variant?: string
  ram?: string
  storage?: string
  colour?: string
}

/**
 * The units a line describes, however they were given.
 *
 * One list from here on, so nothing downstream has to know which form the
 * caller used.
 */
export function unitsOf(line: PurchaseLineInput): PurchaseUnitInput[] {
  if (line.units?.length) {
    return line.units.filter((u) => u.identifier.trim())
  }
  return (line.identifiers ?? [])
    .filter((v) => v.trim())
    .map((identifier) => ({ identifier }))
}

/** A unit's spec, or the line's if it did not say. */
function specFor(line: PurchaseLineInput, unit: PurchaseUnitInput) {
  const pick = (a?: string, b?: string) => a?.trim() || b?.trim() || undefined
  return {
    variant: pick(unit.variant, line.variant),
    ram: pick(unit.ram, line.ram),
    storage: pick(unit.storage, line.storage),
    colour: pick(unit.colour, line.colour),
    batteryHealthPercent: unit.batteryHealthPercent ?? null,
  }
}

export type PurchaseInput = {
  supplierId: number
  branchId: number
  purchaseDate?: Date
  supplierInvoiceNumber?: string
  notes?: string
  lines: PurchaseLineInput[]
}

function lineTotal(line: PurchaseLineInput): bigint {
  const gross = line.unitCostPaise * BigInt(line.quantity)
  return gross - (line.discountPaise ?? 0n) + (line.taxPaise ?? 0n)
}

/**
 * A serialised line must carry exactly as many identifiers as units. Five
 * IMEIs is five handsets - never four, never six.
 */
async function validateLines(actor: AuthUser, lines: PurchaseLineInput[], tx: DbOrTx) {
  if (lines.length === 0) throw new AppError('A purchase needs at least one line.', 422, 'NO_LINES')

  const productIds = [...new Set(lines.map((l) => l.productId))]
  const products = await tx
    .select({ id: product.id, name: product.name, isSerialised: product.isSerialised })
    .from(product)
    .where(and(eq(product.businessId, actor.businessId), inArray(product.id, productIds)))
  const byId = new Map(products.map((p) => [p.id, p]))

  for (const line of lines) {
    const p = byId.get(line.productId)
    if (!p) throw new AppError('A line references a product that does not exist.', 422, 'BAD_PRODUCT')
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new AppError(`${p.name}: quantity must be at least 1.`, 422, 'BAD_QUANTITY')
    }
    if (line.unitCostPaise < 0n) {
      throw new AppError(`${p.name}: cost cannot be negative.`, 422, 'BAD_COST')
    }

    if (p.isSerialised) {
      const supplied = unitsOf(line).length
      if (!line.mainType) {
        throw new AppError(`${p.name}: choose a main type for this line.`, 422, 'NO_MAIN_TYPE')
      }
      if (line.isNewCut && line.mainType !== 'GLOBAL') {
        throw new AppError(
          `${p.name}: NEW CUT applies only to GLOBAL devices.`,
          422,
          'NEW_CUT_NOT_GLOBAL',
        )
      }
      if (supplied !== line.quantity) {
        throw new AppError(
          `${p.name}: ${line.quantity} unit${line.quantity === 1 ? '' : 's'} ordered but ${supplied} identifier${supplied === 1 ? '' : 's'} entered. Each unit needs its own.`,
          422,
          'IDENTIFIER_COUNT_MISMATCH',
        )
      }
    } else if (unitsOf(line).length > 0) {
      throw new AppError(
        `${p.name} is counted by quantity and takes no identifiers.`,
        422,
        'UNEXPECTED_IDENTIFIERS',
      )
    }
  }
  return byId
}

/**
 * Create and confirm in one go. There is no separate draft step in the UI yet;
 * the status column exists so a future "save draft" (and a merged-in importer,
 * docs/02 §2.3) can use
 * it without a migration.
 */
export async function createPurchase(
  actor: AuthUser,
  ctx: AuditContext,
  input: PurchaseInput,
): Promise<{ id: number; purchaseNumber: string; deviceIds: number[] }> {
  await assertBranchAcceptsTransactions(actor, input.branchId)
  await assertPartySelectable(actor, 'supplier', input.supplierId)

  return db.transaction(async (tx) => {
    const products = await validateLines(actor, input.lines, tx)

    const subtotal = input.lines.reduce(
      (sum, l) => sum + l.unitCostPaise * BigInt(l.quantity),
      0n,
    )
    const discount = input.lines.reduce((sum, l) => sum + (l.discountPaise ?? 0n), 0n)
    const tax = input.lines.reduce((sum, l) => sum + (l.taxPaise ?? 0n), 0n)
    const total = subtotal - discount + tax
    if (total < 0n) throw new AppError('Discount cannot exceed the purchase value.', 422, 'BAD_TOTAL')

    const purchaseNumber = await nextDocumentNumber(tx, {
      businessId: actor.businessId,
      kind: 'purchase',
      prefix: 'PUR-',
    })

    const created = (
      await tx
        .insert(purchase)
        .values({
          businessId: actor.businessId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          purchaseNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
          purchaseDate: input.purchaseDate ?? new Date(),
          status: 'CONFIRMED',
          subtotalPaise: subtotal,
          discountPaise: discount,
          taxPaise: tax,
          totalPaise: total,
          notes: input.notes?.trim() || null,
          confirmedAt: new Date(),
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning()
    )[0]!

    const deviceIds: number[] = []

    for (const line of input.lines) {
      const p = products.get(line.productId)!
      const item = (
        await tx
          .insert(purchaseItem)
          .values({
            purchaseId: created.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCostPaise: line.unitCostPaise,
            discountPaise: line.discountPaise ?? 0n,
            taxRateId: line.taxRateId ?? null,
            taxPaise: line.taxPaise ?? 0n,
            lineTotalPaise: lineTotal(line),
            isSerialised: p.isSerialised,
            mainType: p.isSerialised ? (line.mainType ?? null) : null,
            isNewCut: p.isSerialised ? (line.isNewCut ?? false) : false,
            newCutNotes: line.newCutNotes?.trim() || null,
            variant: p.isSerialised ? line.variant?.trim() || null : null,
            ram: p.isSerialised ? line.ram?.trim() || null : null,
            storage: p.isSerialised ? line.storage?.trim() || null : null,
            colour: p.isSerialised ? line.colour?.trim() || null : null,
          })
          .returning()
      )[0]!

      if (p.isSerialised) {
        // One device per identifier. createDevice writes the PURCHASED event
        // and enforces the classification and duplicate rules.
        const identifierType = await identifierTypeForProduct(line.productId, tx)
        const unitCost = line.unitCostPaise
        for (const unit of unitsOf(line)) {
          const device = await createDevice(
            actor,
            ctx,
            {
              productId: line.productId,
              identifiers: [unit.identifier],
              mainType: line.mainType!,
              isNewCut: line.isNewCut,
              newCutNotes: line.newCutNotes,
              /*
               * The specs the goods actually arrived with, so a handset is
               * complete the moment it is booked in. Before this they had to
               * be typed in afterwards, one device screen at a time.
               */
              ...specFor(line, unit),
              purchasePricePaise: unitCost,
              supplierId: input.supplierId,
              purchaseDate: input.purchaseDate ?? new Date(),
              receivedAt: input.purchaseDate ?? undefined,
              branchId: input.branchId,
            },
            tx,
          )
          await tx
            .update(deviceUnit)
            .set({ purchaseItemId: item.id })
            .where(eq(deviceUnit.id, device.id))
          deviceIds.push(device.id)
          void identifierType
        }
      } else {
        await increaseStock(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'purchase',
            refId: created.id,
            // A backdated purchase dates its stock movement too, or M10's
            // movement report puts the goods on the wrong day.
            occurredAt: input.purchaseDate ?? undefined,
          },
          {
            productId: line.productId,
            branchId: input.branchId,
            quantity: line.quantity,
            movement: 'PURCHASE',
          },
          tx,
        )
      }
    }

    // The shop now owes the supplier.
    await postLedgerEntry(tx, {
      businessId: actor.businessId,
      supplierId: input.supplierId,
      branchId: input.branchId,
      entryType: 'PURCHASE',
      amountPaise: total,
      refType: 'purchase',
      refId: created.id,
      note: purchaseNumber,
      actorId: actor.id,
    })

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'purchase',
        entityId: created.id,
        summary: `Confirmed purchase ${purchaseNumber} (${input.lines.length} line${input.lines.length === 1 ? '' : 's'})`,
      },
      tx,
    )

    return { id: created.id, purchaseNumber, deviceIds }
  })
}

/**
 * PRD FR-5.15. A purchase can only be reversed while every unit it brought in
 * is still untouched. If any has moved on, the error names the blocking ones -
 * "it failed" is useless when you are holding twenty handsets.
 */
export async function reversePurchase(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
) {
  const existing = await getPurchase(actor, id)
  if (existing.purchase.status !== 'CONFIRMED') {
    throw new AppError('Only a confirmed purchase can be reversed.', 422, 'NOT_CONFIRMED')
  }

  const paid = await purchasePaidPaise(id)
  if (paid > 0n) {
    throw new AppError(
      'This purchase has payments against it. Void those first, then reverse it.',
      422,
      'HAS_PAYMENTS',
    )
  }

  return db.transaction(async (tx) => {
    const itemIds = existing.items.map((i) => i.id)

    const devices = itemIds.length
      ? await tx
          .select({
            id: deviceUnit.id,
            status: deviceUnit.status,
            identifier: deviceUnit.primaryIdentifier,
          })
          .from(deviceUnit)
          .where(inArray(deviceUnit.purchaseItemId, itemIds))
      : []

    const moved = devices.filter((d) => d.status !== 'IN_STOCK')
    if (moved.length > 0) {
      const names = moved.map((d) => `${d.identifier ?? `#${d.id}`} (${d.status})`)
      throw conflict(
        `This purchase cannot be reversed — ${moved.length} of its devices ${moved.length === 1 ? 'has' : 'have'} already moved on: ${names.slice(0, 5).join(', ')}${names.length > 5 ? `, and ${names.length - 5} more` : ''}.`,
        { blockedBy: names },
      )
    }

    /**
     * Untouched units become VOIDED rather than being deleted: device_event is
     * append-only and inventory records move to a state, never disappear
     * (docs/02 §2.2 rule 4).
     *
     * Their identifiers ARE released, so a corrected purchase can reuse the
     * same IMEIs. Only the claim on the number is given up; the history and
     * the fact that the unit once existed both remain.
     */
    for (const d of devices) {
      await setDeviceStatus(
        {
          businessId: actor.businessId,
          actorId: actor.id,
          refType: 'purchase_reversal',
          refId: id,
        },
        {
          deviceId: d.id,
          expectedStatus: 'IN_STOCK',
          nextStatus: 'VOIDED',
          eventType: 'VOIDED',
          payload: { reason: reason.trim(), purchaseNumber: existing.purchase.purchaseNumber },
        },
        tx,
      )
      await tx.delete(deviceIdentifier).where(eq(deviceIdentifier.deviceId, d.id))
    }

    // Counted lines give their quantity back.
    // decreaseStock, not increaseStock with a negative: increaseStock takes
    // the absolute value, so -5 would have ADDED five units.
    for (const item of existing.items.filter((i) => !i.isSerialised)) {
      await decreaseStock(
        {
          businessId: actor.businessId,
          actorId: actor.id,
          refType: 'purchase_reversal',
          refId: id,
        },
        {
          productId: item.productId,
          branchId: existing.purchase.branchId,
          quantity: item.quantity,
          movement: 'ADJUSTMENT',
        },
        tx,
      )
    }

    // The debt is cancelled by an offsetting entry, never by editing history.
    await postLedgerEntry(tx, {
      businessId: actor.businessId,
      supplierId: existing.purchase.supplierId,
      branchId: existing.purchase.branchId,
      entryType: 'REVERSAL',
      amountPaise: -existing.purchase.totalPaise,
      refType: 'purchase',
      refId: id,
      note: `Reversal of ${existing.purchase.purchaseNumber}`,
      actorId: actor.id,
    })

    await tx
      .update(purchase)
      .set({
        status: 'REVERSED',
        reversedAt: new Date(),
        reversalReason: reason.trim(),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(purchase.id, id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'purchase',
        entityId: id,
        summary: `Reversed purchase ${existing.purchase.purchaseNumber}: ${reason.trim()}`,
      },
      tx,
    )
  })
}

/* ------------------------------------------------------------- reading --- */

export async function getPurchase(actor: AuthUser, id: number) {
  const rows = await db
    .select({
      purchase,
      supplierName: supplier.name,
      supplierCompany: supplier.company,
      branchName: branch.name,
      branchCode: branch.code,
    })
    .from(purchase)
    .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
    .innerJoin(branch, eq(branch.id, purchase.branchId))
    .where(and(eq(purchase.id, id), eq(purchase.businessId, actor.businessId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('Purchase')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.purchase.branchId)) throw notFound('Purchase')

  const items = await db
    .select({
      id: purchaseItem.id,
      productId: purchaseItem.productId,
      productName: product.name,
      quantity: purchaseItem.quantity,
      unitCostPaise: purchaseItem.unitCostPaise,
      discountPaise: purchaseItem.discountPaise,
      taxPaise: purchaseItem.taxPaise,
      lineTotalPaise: purchaseItem.lineTotalPaise,
      isSerialised: purchaseItem.isSerialised,
      mainType: purchaseItem.mainType,
      isNewCut: purchaseItem.isNewCut,
      variant: purchaseItem.variant,
      ram: purchaseItem.ram,
      storage: purchaseItem.storage,
      colour: purchaseItem.colour,
    })
    .from(purchaseItem)
    .innerJoin(product, eq(product.id, purchaseItem.productId))
    .where(eq(purchaseItem.purchaseId, id))
    .orderBy(purchaseItem.id)

  const devices = items.length
    ? await db
        .select({
          id: deviceUnit.id,
          purchaseItemId: deviceUnit.purchaseItemId,
          identifier: deviceUnit.primaryIdentifier,
          status: deviceUnit.status,
          mainType: deviceUnit.mainType,
          isNewCut: deviceUnit.isNewCut,
        })
        .from(deviceUnit)
        .where(
          inArray(
            deviceUnit.purchaseItemId,
            items.map((i) => i.id),
          ),
        )
    : []

  const paidPaise = await purchasePaidPaise(id)

  return {
    ...row,
    items,
    devices,
    paidPaise,
    paymentStatus: paymentStatusFor(row.purchase.totalPaise, paidPaise),
    canSeeCost: hasPermission(actor, 'inventory.view_cost'),
  }
}

export type PurchaseFilters = {
  search?: string
  supplierId?: number
  branchId?: number
  status?: 'DRAFT' | 'CONFIRMED' | 'REVERSED'
  page: number
  pageSize: number
}

export async function listPurchases(actor: AuthUser, filters: PurchaseFilters) {
  const conditions: SQL[] = [eq(purchase.businessId, actor.businessId)]

  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(scope.length > 0 ? inArray(purchase.branchId, scope) : sql`false`)
  }
  if (filters.supplierId) conditions.push(eq(purchase.supplierId, filters.supplierId))
  if (filters.status) conditions.push(eq(purchase.status, filters.status))
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      sql`(${purchase.purchaseNumber} ilike ${term}
        or ${purchase.supplierInvoiceNumber} ilike ${term}
        or ${supplier.name} ilike ${term})`,
    )
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        supplierInvoiceNumber: purchase.supplierInvoiceNumber,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
        totalPaise: purchase.totalPaise,
        supplierName: supplier.name,
        branchName: branch.name,
        branchCode: branch.code,
        lineCount: sql<number>`(
          select count(*)::int from ${purchaseItem}
          where ${purchaseItem.purchaseId} = ${purchase.id}
        )`,
        paidPaise: sql<string>`(
          select coalesce(sum(a.amount_paise), 0)
          from supplier_payment_allocation a
          join supplier_payment sp on sp.id = a.payment_id
          where a.purchase_id = ${purchase.id} and sp.voided_at is null
        )`,
      })
      .from(purchase)
      .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
      .innerJoin(branch, eq(branch.id, purchase.branchId))
      .where(where)
      .orderBy(desc(purchase.purchaseDate), desc(purchase.id))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ n: count() })
      .from(purchase)
      .innerJoin(supplier, eq(supplier.id, purchase.supplierId))
      .where(where),
  ])

  return {
    rows: rows.map((r) => {
      const paid = BigInt(r.paidPaise)
      return { ...r, paidPaise: paid, paymentStatus: paymentStatusFor(r.totalPaise, paid) }
    }),
    total: totals[0]?.n ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

/**
 * Correct a purchase's metadata (carried into M7 from M5).
 *
 * A confirmed purchase can be reversed but not edited, so a typo in a supplier
 * invoice number had no fix once a unit from it had sold - reversal is refused
 * at that point, and the shop was left with a wrong number on the record it
 * reconciles the supplier's account against.
 *
 * Only the metadata moves. Lines, quantities and costs stay uneditable: a
 * confirmed purchase has already moved stock, created device units and posted
 * to the supplier ledger, so editing a cost afterwards would leave the ledger
 * disagreeing with the stock and nothing to reconcile against. Reversal
 * already handles that case honestly.
 */
export async function updatePurchaseMeta(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: { supplierInvoiceNumber?: string | null; purchaseDate?: Date; notes?: string | null },
): Promise<void> {
  const before = (
    await db
      .select()
      .from(purchase)
      .where(and(eq(purchase.id, id), eq(purchase.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!before) throw notFound('Purchase')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(before.branchId)) throw notFound('Purchase')

  if (before.status === 'REVERSED') {
    throw conflict('A reversed purchase is a closed record and is not edited.')
  }

  const values = {
    supplierInvoiceNumber:
      input.supplierInvoiceNumber === undefined
        ? before.supplierInvoiceNumber
        : input.supplierInvoiceNumber?.trim() || null,
    purchaseDate: input.purchaseDate ?? before.purchaseDate,
    notes: input.notes === undefined ? before.notes : input.notes?.trim() || null,
    updatedAt: new Date(),
  }

  await db.update(purchase).set(values).where(eq(purchase.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'purchase',
    entityId: id,
    summary: `Corrected purchase ${before.purchaseNumber ?? id}`,
    changes: diff(before, values),
  })
}
