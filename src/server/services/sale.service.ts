import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, type DbOrTx } from '@/server/db'
import {
  branch,
  business,
  customer,
  deviceUnit,
  paymentMethod,
  product,
  sale,
  saleItem,
  salePayment,
  taxRate,
  type MainType,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { computeBill, computeLine } from '@/lib/tax'
import { assertBranchAcceptsTransactions } from './branch.service'
import { assertPartySelectable } from './party.service'
import { decreaseStock, setDeviceStatus } from './stock.service'
import { nextDocumentNumber } from './sequence.service'

/**
 * Sales (PRD FR-6.1 - FR-6.8).
 *
 * Completing a sale does everything in one transaction: stock down, devices
 * marked SOLD, payments posted, invoice numbered. A half-written bill is not
 * possible (docs/02 §2.2 rule 3).
 */

export type SaleLineInput = {
  productId: number
  /** Serialised lines only. Exactly one handset. */
  deviceId?: number | null
  quantity: number
  unitPricePaise: bigint
  discountPaise?: bigint
  taxRateId?: number | null
}

export type SaleInput = {
  branchId: number
  customerId?: number | null
  lines: SaleLineInput[]
  payments: { paymentMethodId: number; amountPaise: bigint; reference?: string }[]
  billDiscountPaise?: bigint
  notes?: string
  soldAt?: Date
  /** From the browser, so a retry cannot bill the customer twice. */
  idempotencyKey?: string
}

/**
 * PRD FR-38.2 - a device billed in the other system is refused here, at save
 * time as well as in search. This is what makes it impossible for the same
 * handset to be invoiced twice across the two systems.
 */
export function assertSellableChannel(channel: string, identifier: string | null) {
  if (channel === 'EXTERNAL') {
    throw new AppError(
      `${identifier ?? 'This device'} is billed through the other system and cannot be sold here.`,
      422,
      'EXTERNAL_CHANNEL',
    )
  }
}

/** Which invoice series this branch uses (PRD FR-26.3). */
async function invoiceSeriesFor(
  tx: DbOrTx,
  businessId: number,
  branchId: number,
): Promise<{ prefix: string; branchId: number | null }> {
  const rows = await tx
    .select({ branchPrefix: branch.invoicePrefix, businessPrefix: business.invoicePrefix })
    .from(branch)
    .innerJoin(business, eq(business.id, branch.businessId))
    .where(eq(branch.id, branchId))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Branch')

  // A branch with its own prefix gets its own series; otherwise the business
  // runs one shared series.
  return row.branchPrefix
    ? { prefix: `${row.branchPrefix}-`, branchId }
    : { prefix: `${row.businessPrefix}-`, branchId: null }
}

export async function createSale(
  actor: AuthUser,
  ctx: AuditContext,
  input: SaleInput,
): Promise<{ id: number; invoiceNumber: string; reused: boolean }> {
  if (input.lines.length === 0) throw new AppError('A bill needs at least one line.', 422, 'NO_LINES')
  await assertBranchAcceptsTransactions(actor, input.branchId)
  if (input.customerId) await assertPartySelectable(actor, 'customer', input.customerId)

  // Idempotency: a retry after a dropped connection returns the original bill
  // rather than creating a second one (PRD NFR §9.3).
  if (input.idempotencyKey) {
    const existing = await db
      .select({ id: sale.id, invoiceNumber: sale.invoiceNumber })
      .from(sale)
      .where(
        and(
          eq(sale.businessId, actor.businessId),
          eq(sale.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)
    if (existing[0]) return { ...existing[0], reused: true }
  }

  const settings = (
    await db
      .select({ pricesIncludeTax: business.pricesIncludeTax })
      .from(business)
      .where(eq(business.id, actor.businessId))
      .limit(1)
  )[0]
  const pricesIncludeTax = settings?.pricesIncludeTax ?? true

  return db.transaction(async (tx) => {
    // Resolve products, devices and tax rates in one go.
    const productIds = [...new Set(input.lines.map((l) => l.productId))]
    const products = await tx
      .select({ id: product.id, name: product.name, isSerialised: product.isSerialised })
      .from(product)
      .where(and(eq(product.businessId, actor.businessId), inArray(product.id, productIds)))
    const productById = new Map(products.map((p) => [p.id, p]))

    const rateIds = input.lines.map((l) => l.taxRateId).filter((v): v is number => !!v)
    const rates = rateIds.length
      ? await tx
          .select({ id: taxRate.id, bp: taxRate.rateBasisPoints })
          .from(taxRate)
          .where(and(eq(taxRate.businessId, actor.businessId), inArray(taxRate.id, rateIds)))
      : []
    const rateById = new Map(rates.map((r) => [r.id, r.bp]))

    const deviceIds = input.lines.map((l) => l.deviceId).filter((v): v is number => !!v)
    const devices = deviceIds.length
      ? await tx
          .select({
            id: deviceUnit.id,
            status: deviceUnit.status,
            branchId: deviceUnit.currentBranchId,
            channel: deviceUnit.salesChannel,
            identifier: deviceUnit.primaryIdentifier,
            mainType: deviceUnit.mainType,
            isNewCut: deviceUnit.isNewCut,
            productId: deviceUnit.productId,
          })
          .from(deviceUnit)
          .where(
            and(
              eq(deviceUnit.businessId, actor.businessId),
              inArray(deviceUnit.id, deviceIds),
            ),
          )
      : []
    const deviceById = new Map(devices.map((d) => [d.id, d]))

    // Validate every line before writing anything.
    const prepared = input.lines.map((line) => {
      const p = productById.get(line.productId)
      if (!p) throw new AppError('A line references a product that does not exist.', 422, 'BAD_PRODUCT')

      const bp = line.taxRateId ? (rateById.get(line.taxRateId) ?? 0) : 0

      if (p.isSerialised) {
        if (!line.deviceId) {
          throw new AppError(`${p.name} is sold by identifier — choose a unit.`, 422, 'NO_DEVICE')
        }
        const d = deviceById.get(line.deviceId)
        if (!d) throw notFound('Device')
        assertSellableChannel(d.channel, d.identifier)
        if (d.branchId !== input.branchId) {
          throw new AppError(
            `${d.identifier ?? 'That device'} is not at this branch.`,
            422,
            'WRONG_BRANCH',
          )
        }
        if (d.status !== 'IN_STOCK') {
          throw conflict(
            `${d.identifier ?? 'That device'} is no longer available (${d.status}).`,
          )
        }
        if (line.quantity !== 1) {
          throw new AppError('A device line sells exactly one unit.', 422, 'BAD_QUANTITY')
        }
      } else if (line.deviceId) {
        throw new AppError(`${p.name} is counted by quantity, not by identifier.`, 422, 'NOT_SERIALISED')
      }

      return { line, product: p, bp, device: line.deviceId ? deviceById.get(line.deviceId)! : null }
    })

    const totals = computeBill(
      prepared.map((x) => ({
        unitPricePaise: x.line.unitPricePaise,
        quantity: x.line.quantity,
        discountPaise: x.line.discountPaise,
        taxRateBasisPoints: x.bp,
      })),
      pricesIncludeTax,
      input.billDiscountPaise ?? 0n,
    )

    const paid = input.payments.reduce((sum, p) => sum + p.amountPaise, 0n)
    if (paid > totals.totalPaise) {
      throw new AppError('Payment is more than the bill total.', 422, 'OVERPAID')
    }
    // Anything unpaid is credit, and credit needs someone to owe it (FR-7.2).
    if (paid < totals.totalPaise && !input.customerId) {
      throw new AppError(
        'An unpaid balance needs a customer — a walk-in cannot be given credit.',
        422,
        'CREDIT_NEEDS_CUSTOMER',
      )
    }

    const series = await invoiceSeriesFor(tx, actor.businessId, input.branchId)
    const invoiceNumber = await nextDocumentNumber(tx, {
      businessId: actor.businessId,
      kind: 'invoice',
      branchId: series.branchId,
      prefix: series.prefix,
    })

    const created = (
      await tx
        .insert(sale)
        .values({
          businessId: actor.businessId,
          branchId: input.branchId,
          customerId: input.customerId ?? null,
          invoiceNumber,
          soldAt: input.soldAt ?? new Date(),
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          taxablePaise: totals.taxablePaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          pricesIncludedTax: pricesIncludeTax,
          idempotencyKey: input.idempotencyKey ?? null,
          notes: input.notes?.trim() || null,
          soldBy: actor.id,
        })
        .returning()
    )[0]!

    for (const { line, product: p, bp, device } of prepared) {
      const computed = computeLine(
        {
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
          discountPaise: line.discountPaise,
          taxRateBasisPoints: bp,
        },
        pricesIncludeTax,
      )

      await tx.insert(saleItem).values({
        saleId: created.id,
        productId: line.productId,
        deviceId: line.deviceId ?? null,
        description: p.name,
        // Snapshots, so a reprint reads as it did on the day.
        identifierSnapshot: device?.identifier ?? null,
        mainTypeSnapshot: device?.mainType ?? null,
        isNewCutSnapshot: device?.isNewCut ?? false,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountPaise: line.discountPaise ?? 0n,
        taxRateId: line.taxRateId ?? null,
        taxRateBasisPoints: bp,
        taxablePaise: computed.taxablePaise,
        taxPaise: computed.taxPaise,
        lineTotalPaise: computed.totalPaise,
      })

      if (device) {
        // Conditional on still being IN_STOCK: two tills cannot both sell it.
        await setDeviceStatus(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'sale',
            refId: created.id,
          },
          {
            deviceId: device.id,
            expectedStatus: 'IN_STOCK',
            nextStatus: 'SOLD',
            eventType: 'SOLD',
            branchId: input.branchId,
            payload: { invoiceNumber, pricePaise: String(computed.totalPaise) },
          },
          tx,
        )
      } else {
        await decreaseStock(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'sale',
            refId: created.id,
          },
          {
            productId: line.productId,
            branchId: input.branchId,
            quantity: line.quantity,
            movement: 'SALE',
          },
          tx,
        )
      }
    }

    for (const p of input.payments) {
      if (p.amountPaise <= 0n) continue
      await tx.insert(salePayment).values({
        saleId: created.id,
        paymentMethodId: p.paymentMethodId,
        amountPaise: p.amountPaise,
        reference: p.reference?.trim() || null,
      })
    }

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'sale',
        entityId: created.id,
        summary: `Sold ${invoiceNumber} — ${input.lines.length} line(s)`,
      },
      tx,
    )

    return { id: created.id, invoiceNumber, reused: false }
  })
}

/* ------------------------------------------------------------- reading --- */

export async function salePaidPaise(saleId: number, tx: DbOrTx = db): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(${salePayment.amountPaise}), 0)` })
    .from(salePayment)
    .where(eq(salePayment.saleId, saleId))
  return BigInt(rows[0]?.total ?? '0')
}

export function salePaymentStatus(totalPaise: bigint, paidPaise: bigint) {
  if (paidPaise <= 0n) return 'UNPAID' as const
  if (paidPaise >= totalPaise) return 'PAID' as const
  return 'PARTIAL' as const
}

export async function getSale(actor: AuthUser, id: number) {
  const rows = await db
    .select({
      sale,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerGstin: customer.gstin,
      branchName: branch.name,
      branchCode: branch.code,
    })
    .from(sale)
    .leftJoin(customer, eq(customer.id, sale.customerId))
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(and(eq(sale.id, id), eq(sale.businessId, actor.businessId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('Sale')
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.sale.branchId)) throw notFound('Sale')

  const [items, payments, paid] = await Promise.all([
    db.select().from(saleItem).where(eq(saleItem.saleId, id)).orderBy(asc(saleItem.id)),
    db
      .select({
        id: salePayment.id,
        amountPaise: salePayment.amountPaise,
        reference: salePayment.reference,
        methodName: paymentMethod.name,
      })
      .from(salePayment)
      .innerJoin(paymentMethod, eq(paymentMethod.id, salePayment.paymentMethodId))
      .where(eq(salePayment.saleId, id)),
    salePaidPaise(id),
  ])

  return {
    ...row,
    items,
    payments,
    paidPaise: paid,
    paymentStatus: salePaymentStatus(row.sale.totalPaise, paid),
    canSeeCost: hasPermission(actor, 'inventory.view_cost'),
  }
}

export type SaleFilters = {
  search?: string
  branchId?: number
  customerId?: number
  /** UNPAID / PARTIAL / PAID, computed from what has been received. */
  paymentStatus?: 'UNPAID' | 'PARTIAL' | 'PAID'
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

export async function listSales(actor: AuthUser, filters: SaleFilters) {
  const conditions: SQL[] = [eq(sale.businessId, actor.businessId)]
  const scope = branchScope(actor, filters.branchId ?? null)
  if (scope !== null) {
    conditions.push(scope.length > 0 ? inArray(sale.branchId, scope) : sql`false`)
  }
  if (filters.customerId) conditions.push(eq(sale.customerId, filters.customerId))
  if (filters.from) conditions.push(sql`${sale.soldAt} >= ${filters.from}`)
  if (filters.to) conditions.push(sql`${sale.soldAt} < ${filters.to}`)

  // Payment status is derived, so it is filtered with the same expression the
  // list displays - there is no stored column that could disagree.
  if (filters.paymentStatus) {
    const paidExpr = sql`(select coalesce(sum(sp.amount_paise), 0)
      from sale_payment sp where sp.sale_id = ${sale.id})`
    if (filters.paymentStatus === 'PAID') conditions.push(sql`${paidExpr} >= ${sale.totalPaise}`)
    else if (filters.paymentStatus === 'UNPAID') conditions.push(sql`${paidExpr} <= 0`)
    else conditions.push(sql`${paidExpr} > 0 and ${paidExpr} < ${sale.totalPaise}`)
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      sql`(${sale.invoiceNumber} ilike ${term} or ${customer.name} ilike ${term}
        or exists (select 1 from sale_item si where si.sale_id = ${sale.id}
                   and si.identifier_snapshot ilike ${term}))`,
    )
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        soldAt: sale.soldAt,
        status: sale.status,
        totalPaise: sale.totalPaise,
        customerName: customer.name,
        branchName: branch.name,
        branchCode: branch.code,
        itemCount: sql<number>`(select count(*)::int from ${saleItem} where ${saleItem.saleId} = ${sale.id})`,
        paidPaise: sql<string>`(select coalesce(sum(sp.amount_paise), 0)
          from sale_payment sp where sp.sale_id = ${sale.id})`,
      })
      .from(sale)
      .leftJoin(customer, eq(customer.id, sale.customerId))
      .innerJoin(branch, eq(branch.id, sale.branchId))
      .where(where)
      .orderBy(desc(sale.soldAt), desc(sale.id))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ n: count() })
      .from(sale)
      .leftJoin(customer, eq(customer.id, sale.customerId))
      .where(where),
  ])

  return {
    rows: rows.map((r) => {
      const paid = BigInt(r.paidPaise)
      return { ...r, paidPaise: paid, paymentStatus: salePaymentStatus(r.totalPaise, paid) }
    }),
    total: totals[0]?.n ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export type { MainType }


/**
 * PRD FR-38.3 - mark a device sold in the other billing system.
 *
 * Stock drops immediately so it cannot also be sold here, and M12's daily
 * import later completes the record with the real invoice number, date and
 * price. This is the fallback for BOTH-channel devices; the normal path for
 * an EXTERNAL device is that it never reaches this till at all.
 */
export async function markSoldExternally(
  actor: AuthUser,
  ctx: AuditContext,
  deviceId: number,
  note?: string,
) {
  const rows = await db
    .select({
      id: deviceUnit.id,
      status: deviceUnit.status,
      channel: deviceUnit.salesChannel,
      identifier: deviceUnit.primaryIdentifier,
      branchId: deviceUnit.currentBranchId,
    })
    .from(deviceUnit)
    .where(and(eq(deviceUnit.id, deviceId), eq(deviceUnit.businessId, actor.businessId)))
    .limit(1)

  const device = rows[0]
  if (!device) throw notFound('Device')
  if (device.channel === 'ECITY') {
    throw new AppError(
      `${device.identifier ?? 'This device'} is sold here, not in the other system. Bill it normally.`,
      422,
      'NOT_EXTERNAL',
    )
  }
  if (device.status !== 'IN_STOCK') {
    throw conflict(`${device.identifier ?? 'This device'} is no longer in stock (${device.status}).`)
  }

  await setDeviceStatus(
    { businessId: actor.businessId, actorId: actor.id, refType: 'external_sale' },
    {
      deviceId,
      expectedStatus: 'IN_STOCK',
      nextStatus: 'SOLD_PENDING_IMPORT',
      eventType: 'SOLD',
      branchId: device.branchId,
      payload: { channel: device.channel, note: note?.trim() ?? null, awaitingImport: true },
    },
  )

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'device_unit',
    entityId: deviceId,
    summary: `Marked ${device.identifier ?? `#${deviceId}`} sold in the other system`,
  })
}
