import { and, asc, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
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
  tradeIn,
  type MainType,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, isUniqueViolation, notFound } from '@/server/http'
import { branchScope, hasPermission, type AuthUser } from '@/server/auth/permissions'
import { computeBill, computeLine } from '@/lib/tax'
import {
  postCustomerLedgerEntry,
  saleReceivedPaise,
  saleReceivedSql,
} from './customer-ledger.service'
import {
  isInterState,
  normaliseStateCode,
  placeOfSupply,
  stateCodeFromGstin,
} from '@/lib/gst'
import { assertBranchAcceptsTransactions } from './branch.service'
import { postByPaymentMethod } from './cash.service'
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
  /** PRD FR-7.2. When the balance is expected, if the bill leaves unpaid. */
  dueDate?: Date | null
  creditNotes?: string
  /** From the browser, so a retry cannot bill the customer twice. */
  idempotencyKey?: string
  /**
   * PRD FR-9.2. A handset taken in part-exchange. Accepted first (it becomes a
   * device unit in its own right), then attached to the bill it settles.
   */
  tradeInId?: number | null
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
    const existing = await findByIdempotencyKey(actor.businessId, input.idempotencyKey)
    if (existing) return { ...existing, reused: true }
  }

  const settings = (
    await db
      .select({
        pricesIncludeTax: business.pricesIncludeTax,
        stateCode: business.stateCode,
        gstin: business.gstin,
        gstEnabled: business.gstEnabled,
        defaultCreditDays: business.defaultCreditDays,
      })
      .from(business)
      .where(eq(business.id, actor.businessId))
      .limit(1)
  )[0]
  const pricesIncludeTax = settings?.pricesIncludeTax ?? true

  /*
   * Is the shop registered? An unregistered dealer charges no GST at all, so
   * the rate is forced to zero here rather than trusted from the request - a
   * stale browser tab still holding a tax rate cannot put tax on a bill.
   *
   * Stamped onto the sale below, because nothing archives the invoice PDF:
   * every reprint is a fresh render, and without this a bill issued today
   * would reprint as a tax invoice the day the shop registers.
   */
  const gstEnabled = settings?.gstEnabled ?? true

  /**
   * Where this supply is taxed (PRD OQ-4).
   *
   * An explicit state code wins; otherwise it comes from the GSTIN, whose
   * first two digits are the state. That keeps rows created before the field
   * existed working without a backfill.
   */
  const branchRow = (
    await db
      .select({ stateCode: branch.stateCode, gstin: branch.gstin })
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.businessId, actor.businessId)))
      .limit(1)
  )[0]
  const supplyStateCode =
    normaliseStateCode(branchRow?.stateCode) ??
    stateCodeFromGstin(branchRow?.gstin) ??
    normaliseStateCode(settings?.stateCode) ??
    stateCodeFromGstin(settings?.gstin)

  const customerRow = input.customerId
    ? (
        await db
          .select({ stateCode: customer.stateCode, gstin: customer.gstin })
          .from(customer)
          .where(
            and(eq(customer.id, input.customerId), eq(customer.businessId, actor.businessId)),
          )
          .limit(1)
      )[0]
    : undefined
  const customerStateCode =
    normaliseStateCode(customerRow?.stateCode) ?? stateCodeFromGstin(customerRow?.gstin)

  // Place of supply only means something under GST. Left null when there is
  // none, so the invoice has nothing to print rather than an empty heading.
  const placeOfSupplyCode = gstEnabled ? placeOfSupply(supplyStateCode, customerStateCode) : null
  const interState = gstEnabled ? isInterState(supplyStateCode, placeOfSupplyCode) : false

  return db.transaction(async (tx) => {
    // Resolve products, devices and tax rates in one go.
    const productIds = [...new Set(input.lines.map((l) => l.productId))]
    const products = await tx
      .select({
        id: product.id,
        name: product.name,
        isSerialised: product.isSerialised,
        hsnCode: product.hsnCode,
      })
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

      const bp = gstEnabled && line.taxRateId ? (rateById.get(line.taxRateId) ?? 0) : 0

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
        hsnCode: x.product.hsnCode,
        unitPricePaise: x.line.unitPricePaise,
        quantity: x.line.quantity,
        discountPaise: x.line.discountPaise,
        taxRateBasisPoints: x.bp,
      })),
      pricesIncludeTax,
      input.billDiscountPaise ?? 0n,
      interState,
    )

    /*
     * PRD FR-9.2. The handset taken in part-exchange. It is NOT a discount:
     * the bill and its GST stay at the full selling price and the agreed value
     * settles part of what is owed, exactly like a payment (docs/02 M6).
     *
     * Locked for the rest of the transaction so two tills cannot both put the
     * same handset against a bill - that would settle its value twice and lose
     * the shop the difference.
     */
    let tradedPaise = 0n
    if (input.tradeInId) {
      const locked = await tx.execute(
        sql`select id, sale_id, branch_id, customer_id, agreed_value_paise
            from trade_in
            where id = ${input.tradeInId} and business_id = ${actor.businessId}
            for update`,
      )
      const row = (locked as unknown as Record<string, unknown>[])[0]
      if (!row) throw notFound('Trade-in')
      if (row.sale_id != null) {
        throw conflict('That trade-in is already on another bill.')
      }
      if (Number(row.branch_id) !== input.branchId) {
        throw new AppError(
          'The trade-in was taken in at a different branch.',
          422,
          'TRADE_IN_BRANCH',
        )
      }
      const tradeCustomer = row.customer_id == null ? null : Number(row.customer_id)
      if (tradeCustomer != null && tradeCustomer !== (input.customerId ?? null)) {
        throw new AppError(
          'The trade-in was taken from a different customer.',
          422,
          'TRADE_IN_CUSTOMER',
        )
      }
      tradedPaise = BigInt(String(row.agreed_value_paise))
    }

    const paid = input.payments.reduce((sum, p) => sum + p.amountPaise, 0n)
    // What the bill has been settled by, cash and handset together.
    const settled = paid + tradedPaise
    if (settled > totals.totalPaise) {
      throw new AppError('Payment is more than the bill total.', 422, 'OVERPAID')
    }
    // Anything unpaid is credit, and credit needs someone to owe it (FR-7.2).
    if (settled < totals.totalPaise && !input.customerId) {
      throw new AppError(
        'An unpaid balance needs a customer — a walk-in cannot be given credit.',
        422,
        'CREDIT_NEEDS_CUSTOMER',
      )
    }

    // A credit bill with no agreed date still gets one, from the business
    // default, so it can be aged and chased rather than drifting forever.
    const soldAt = input.soldAt ?? new Date()
    const defaultDueDate = new Date(
      soldAt.getTime() + (settings?.defaultCreditDays ?? 30) * 86_400_000,
    )

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
          soldAt,
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          taxablePaise: totals.taxablePaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          cgstPaise: totals.cgstPaise,
          sgstPaise: totals.sgstPaise,
          igstPaise: totals.igstPaise,
          placeOfSupplyCode,
          supplyStateCode: gstEnabled ? supplyStateCode : null,
          isInterState: interState,
          pricesIncludedTax: pricesIncludeTax,
          gstEnabled,
          idempotencyKey: input.idempotencyKey ?? null,
          notes: input.notes?.trim() || null,
          // Only a bill that leaves unpaid carries credit terms.
          dueDate: settled < totals.totalPaise ? (input.dueDate ?? defaultDueDate) : null,
          creditNotes: settled < totals.totalPaise ? input.creditNotes?.trim() || null : null,
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
        interState,
      )

      await tx.insert(saleItem).values({
        saleId: created.id,
        productId: line.productId,
        deviceId: line.deviceId ?? null,
        description: p.name,
        // Snapshots, so a reprint reads as it did on the day.
        identifierSnapshot: device?.identifier ?? null,
        // No HSN on a bill from an unregistered dealer - it is a GST code and
        // has no meaning outside one.
        hsnCodeSnapshot: gstEnabled ? p.hsnCode : null,
        mainTypeSnapshot: device?.mainType ?? null,
        isNewCutSnapshot: device?.isNewCut ?? false,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountPaise: line.discountPaise ?? 0n,
        taxRateId: gstEnabled ? (line.taxRateId ?? null) : null,
        taxRateBasisPoints: bp,
        taxablePaise: computed.taxablePaise,
        taxPaise: computed.taxPaise,
        cgstPaise: computed.cgstPaise,
        sgstPaise: computed.sgstPaise,
        igstPaise: computed.igstPaise,
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
            // A backdated bill dates its stock movement too, or M10's
            // movement report and the sales report disagree about the day.
            occurredAt: soldAt,
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
            occurredAt: soldAt,
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

    // FR-9.2. The link that makes an exchange one transaction: old device in,
    // new device out, agreed value and difference paid, all on one bill.
    if (input.tradeInId) {
      await tx
        .update(tradeIn)
        .set({ saleId: created.id, customerId: input.customerId ?? null })
        .where(eq(tradeIn.id, input.tradeInId))
    }

    for (const p of input.payments) {
      if (p.amountPaise <= 0n) continue
      await tx.insert(salePayment).values({
        saleId: created.id,
        paymentMethodId: p.paymentMethodId,
        amountPaise: p.amountPaise,
        reference: p.reference?.trim() || null,
      })
      /*
       * M7 FR-11.2. Cash taken at the counter goes into the branch's drawer;
       * anything else to its account. A drawer that only knew about some of
       * the day's cash would reconcile to nothing.
       */
      await postByPaymentMethod(tx, {
        businessId: actor.businessId,
        branchId: input.branchId,
        paymentMethodId: p.paymentMethodId,
        movement: 'SALE',
        amountPaise: p.amountPaise,
        refType: 'sale',
        refId: created.id,
        note: invoiceNumber,
        occurredAt: soldAt,
      })
    }

    /*
     * PRD FR-7.4. A named customer gets the whole bill posted to their account
     * and every rupee taken at the counter posted back off it. Posting gross
     * rather than just the unpaid remainder is what makes the statement a real
     * account the customer can be shown, instead of a list of debts.
     *
     * A walk-in has no account, so nothing is posted.
     */
    if (input.customerId) {
      await postCustomerLedgerEntry(tx, {
        businessId: actor.businessId,
        customerId: input.customerId,
        branchId: input.branchId,
        entryType: 'SALE',
        amountPaise: totals.totalPaise,
        refType: 'sale',
        refId: created.id,
        note: invoiceNumber,
        actorId: actor.id,
        occurredAt: soldAt,
      })
      if (paid > 0n) {
        await postCustomerLedgerEntry(tx, {
          businessId: actor.businessId,
          customerId: input.customerId,
          branchId: input.branchId,
          entryType: 'PAYMENT',
          amountPaise: -paid,
          refType: 'sale',
          refId: created.id,
          note: `Paid at the counter on ${invoiceNumber}`,
          actorId: actor.id,
          occurredAt: soldAt,
        })
      }
      // Settled in kind. Its own entry rather than folded into the cash line,
      // so the statement shows the customer what actually cleared the bill.
      if (tradedPaise > 0n) {
        await postCustomerLedgerEntry(tx, {
          businessId: actor.businessId,
          customerId: input.customerId,
          branchId: input.branchId,
          entryType: 'PAYMENT',
          amountPaise: -tradedPaise,
          refType: 'sale',
          refId: created.id,
          note: `Trade-in against ${invoiceNumber}`,
          actorId: actor.id,
          occurredAt: soldAt,
        })
      }
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
  }).catch(async (error: unknown) => {
    /*
     * Two tills - or one till and its own retry - sent the same key at the
     * same moment, so both got past the check above and the unique index
     * rejected the second. The bill it lost to is the answer it wanted: the
     * customer is billed once, and the browser that retried gets the invoice
     * rather than "something went wrong" and a reason to try a third time.
     */
    if (input.idempotencyKey && isUniqueViolation(error, 'sale_idempotency_uq')) {
      const existing = await findByIdempotencyKey(actor.businessId, input.idempotencyKey)
      if (existing) return { ...existing, reused: true }
    }
    throw error
  })
}

async function findByIdempotencyKey(
  businessId: number,
  idempotencyKey: string,
): Promise<{ id: number; invoiceNumber: string } | null> {
  const rows = await db
    .select({ id: sale.id, invoiceNumber: sale.invoiceNumber })
    .from(sale)
    .where(and(eq(sale.businessId, businessId), eq(sale.idempotencyKey, idempotencyKey)))
    .limit(1)
  return rows[0] ?? null
}

/* ------------------------------------------------------------- reading --- */

/**
 * What a sale has been paid, counter payments and later collections together.
 *
 * Re-exported from the ledger service so there is exactly one definition:
 * before M5 this counted only sale_payment, and a bill settled by a later
 * receipt would still have shown as UNPAID.
 */
export const salePaidPaise = saleReceivedPaise

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

  const [items, payments, tradeIns, paid] = await Promise.all([
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
    // FR-9.2. What was taken in part-exchange against this bill.
    db
      .select({
        id: tradeIn.id,
        deviceId: tradeIn.deviceId,
        agreedValuePaise: tradeIn.agreedValuePaise,
        identifier: deviceUnit.primaryIdentifier,
      })
      .from(tradeIn)
      .leftJoin(deviceUnit, eq(deviceUnit.id, tradeIn.deviceId))
      .where(eq(tradeIn.saleId, id)),
    salePaidPaise(id),
  ])

  return {
    ...row,
    items,
    payments,
    tradeIns,
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
  /*
   * gte/lt rather than a raw template. A `sql` fragment binds whatever it is
   * given straight to the driver, which wants a string and is handed a Date:
   * every date filter on this list died on the count query. The operators run
   * the value through the column's own mapper, so the type is the column's
   * problem rather than the caller's.
   */
  if (filters.from) conditions.push(gte(sale.soldAt, filters.from))
  if (filters.to) conditions.push(lt(sale.soldAt, filters.to))

  // Payment status is derived, so it is filtered with the same expression the
  // list displays - there is no stored column that could disagree.
  if (filters.paymentStatus) {
    const paidExpr = saleReceivedSql()
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
        paidPaise: saleReceivedSql(),
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
 * Stock drops immediately so it cannot also be sold here. The other system's
 * invoice number is not recorded on this side - nothing is imported between
 * the two businesses (docs/02 §2.3).
 *
 * This is the fallback for a BOTH-channel device, which is rare: NEW stock is
 * a separate business, and the normal path for an EXTERNAL device is that it
 * never reaches this till at all.
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

/**
 * PRD FR-6.7 - what one customer has bought, and what they still owe.
 *
 * Deliberately branch-blind: the PRD asks for total spend *across branches*,
 * and a customer who buys at two shops is still one customer. Access is
 * already gated by `customer.view`.
 */
export async function getCustomerHistory(actor: AuthUser, customerId: number) {
  const paidExpr = saleReceivedSql()

  const rows = await db
    .select({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt,
      status: sale.status,
      totalPaise: sale.totalPaise,
      paidPaise: paidExpr,
      branchName: branch.name,
      itemCount: sql<number>`(
        select count(*)::int from ${saleItem} where ${saleItem.saleId} = ${sale.id}
      )`,
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .where(and(eq(sale.businessId, actor.businessId), eq(sale.customerId, customerId)))
    .orderBy(desc(sale.soldAt), desc(sale.id))

  // A voided bill is history, not money: it must show, but it must not count
  // towards spend or dues.
  const counted = rows.filter((r) => r.status !== 'VOIDED')
  const totalSpentPaise = counted.reduce((sum, r) => sum + r.totalPaise, 0n)
  const totalPaidPaise = counted.reduce((sum, r) => sum + BigInt(r.paidPaise), 0n)

  return {
    sales: rows.map((r) => ({
      ...r,
      paidPaise: BigInt(r.paidPaise),
      paymentStatus: salePaymentStatus(r.totalPaise, BigInt(r.paidPaise)),
    })),
    totalSpentPaise,
    totalPaidPaise,
    outstandingPaise: totalSpentPaise - totalPaidPaise,
    saleCount: counted.length,
    lastPurchaseAt: counted[0]?.soldAt ?? null,
  }
}
