import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { increaseStock, getStock } from '@/server/services/stock.service'
import { createSale, getSale } from '@/server/services/sale.service'
import { createReturn } from '@/server/services/return.service'
import { createPurchase, reversePurchase } from '@/server/services/purchase.service'
import { recordSupplierPayment } from '@/server/services/supplier-payment.service'
import {
  recordCustomerPayment,
  voidCustomerPayment,
} from '@/server/services/customer-payment.service'
import { closeDay } from '@/server/services/closing.service'
import { businessDateFor } from '@/server/services/cash.service'
import { customerBalance } from '@/server/services/customer-ledger.service'
import { AppError } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

/**
 * What happens when two people press the same button at the same moment.
 *
 * Every case here is a check-then-act: the code reads how much is left to
 * return, or whether a receipt is already void, and then writes. Under READ
 * COMMITTED both halves of a pair can read the same "before" state and both
 * pass, which is how goods go back into stock twice and a customer is credited
 * for one payment twice. These assert the guards - a row lock, or an UPDATE
 * conditional on the state it expects - actually serialise the pair.
 *
 * They deliberately run the two operations with `Promise.allSettled` on the
 * shared pool rather than simulating a race, so they exercise real concurrent
 * transactions.
 */

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

/** Both settled: exactly one fulfilled, and the other rejected for the right reason. */
function expectExactlyOneWinner(
  results: PromiseSettledResult<unknown>[],
  expectedStatus: number[],
): void {
  const won = results.filter((r) => r.status === 'fulfilled')
  const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

  expect(won).toHaveLength(1)
  expect(lost).toHaveLength(results.length - 1)

  for (const l of lost) {
    // The loser must be told what happened, not handed a 500.
    expect(l.reason, `loser threw: ${String(l.reason)}`).toBeInstanceOf(AppError)
    expect(expectedStatus).toContain((l.reason as AppError).status)
  }
}

suite('concurrent operations cannot double-count money or stock', () => {
  const stamp = Date.now()
  let businessId: number
  let branchId: number
  let customerId: number
  let cableProductId: number
  /** Serialised, for the identifier-claim race. */
  let phoneProductId: number
  let supplierId: number
  let cashMethodId: number
  let actor: AuthUser
  let ctx: AuditContext
  const rs = (n: number) => BigInt(Math.round(n * 100))

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `CC Test ${stamp}` }).returning()
    )[0]!.id
    branchId = (
      await db
        .insert(schema.branch)
        .values({ businessId, code: `CC${stamp}`.slice(0, 12), name: 'CC Branch' })
        .returning()
    )[0]!.id
    cashMethodId = (
      await db
        .insert(schema.paymentMethod)
        .values({ businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true })
        .returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'CC Tester',
      email: 'cc@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost', 'closing.correct']),
      branchIds: [branchId],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId }

    customerId = (await createParty(actor, ctx, 'customer', { name: `CC Customer ${stamp}` })).id
    supplierId = (await createParty(actor, ctx, 'supplier', { name: `CC Supplier ${stamp}` })).id
    const cables = await createCategory(actor, ctx, { name: 'CC Cables', isSerialised: false })
    cableProductId = (await createProduct(actor, ctx, { name: 'CC Cable', categoryId: cables.id })).id
    const phones = await createCategory(actor, ctx, {
      name: 'CC Phones',
      isSerialised: true,
      identifierType: 'IMEI',
    })
    phoneProductId = (await createProduct(actor, ctx, { name: 'CC Phone', categoryId: phones.id })).id
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId, quantity: 5000, movement: 'PURCHASE' },
    )
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      await db.execute(`delete from refund where business_id = ${businessId}`)
      await db.execute(`delete from return_item where return_id in
        (select id from sales_return where business_id = ${businessId})`)
      await db.execute(`delete from sales_return where business_id = ${businessId}`)
      await clearMoney(businessId)
      await clearCustomerCredit(businessId)
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      await db.execute(`delete from supplier_payment_allocation where payment_id in
        (select id from supplier_payment where business_id = ${businessId})`)
      await db.execute(`delete from supplier_payment where business_id = ${businessId}`)
      await db.execute(`delete from supplier_ledger_entry where business_id = ${businessId}`)
      await db.execute(`delete from purchase_item where purchase_id in
        (select id from purchase where business_id = ${businessId})`)
      await db.execute(`delete from purchase where business_id = ${businessId}`)
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      // The identifier race books in real handsets, so the units it creates
      // have to go before their product can.
      await db.execute(`delete from device_event where device_id in
        (select id from device_unit where business_id = ${businessId})`)
      await db.execute(`delete from device_identifier where device_id in
        (select id from device_unit where business_id = ${businessId})`)
      await db.execute(`delete from device_unit where business_id = ${businessId}`)
      // Every product of this business, not one named one.
      await db.execute(`delete from branch_stock where product_id in
        (select id from product where business_id = ${businessId})`)
      await db.delete(schema.documentSequence).where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  /** A paid cash sale of `qty` cables, and the line that can be returned. */
  async function sellCables(qty: number) {
    const sold = await createSale(actor, ctx, {
      branchId,
      customerId,
      lines: [{ productId: cableProductId, quantity: qty, unitPricePaise: rs(100) }],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(100 * qty) }],
    })
    const detail = await getSale(actor, sold.id)
    return { saleId: sold.id, saleItemId: detail.items[0]!.id }
  }

  it('refuses to return the same accessory line twice at once', async () => {
    const { saleId, saleItemId } = await sellCables(1)
    const before = (await getStock(cableProductId, branchId))!.quantity

    const takeItBack = () =>
      createReturn(actor, ctx, {
        saleId,
        branchId,
        lines: [{ saleItemId, quantity: 1 }],
      })

    const results = await Promise.allSettled([takeItBack(), takeItBack()])
    expectExactlyOneWinner(results, [409, 422])

    // The real assertion: the cable came back once, not twice.
    const after = (await getStock(cableProductId, branchId))!.quantity
    expect(after).toBe(before + 1)

    const returned = await db.execute<{ n: string }>(
      sql`select coalesce(sum(quantity), 0)::text as n
          from return_item where sale_item_id = ${saleItemId}`,
    )
    expect(Number((returned as unknown as { n: string }[])[0]!.n)).toBe(1)
  })

  it('lets two returns of a multi-unit line share it, but never exceed it', async () => {
    const { saleId, saleItemId } = await sellCables(3)

    const takeBack = (n: number) =>
      createReturn(actor, ctx, {
        saleId,
        branchId,
        lines: [{ saleItemId, quantity: n }],
      })

    // 2 + 2 against a line of 3: one must lose.
    const results = await Promise.allSettled([takeBack(2), takeBack(2)])
    expectExactlyOneWinner(results, [409, 422])

    const returned = await db.execute<{ n: string }>(
      sql`select coalesce(sum(quantity), 0)::text as n
          from return_item where sale_item_id = ${saleItemId}`,
    )
    expect(Number((returned as unknown as { n: string }[])[0]!.n)).toBeLessThanOrEqual(3)
  })

  it('credits a customer once when the same receipt is voided twice at once', async () => {
    // An unpaid bill, so there is a balance to move.
    const sold = await createSale(actor, ctx, {
      branchId,
      customerId,
      lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
      payments: [],
    })
    const payment = await recordCustomerPayment(actor, ctx, {
      customerId,
      branchId,
      paymentMethodId: cashMethodId,
      amountPaise: rs(500),
      allocations: [{ saleId: sold.id, amountPaise: rs(500) }],
    })

    const balanceBeforeVoid = await customerBalance(customerId)

    const results = await Promise.allSettled([
      voidCustomerPayment(actor, ctx, payment.id, 'Entered twice'),
      voidCustomerPayment(actor, ctx, payment.id, 'Entered twice'),
    ])
    expectExactlyOneWinner(results, [409, 422])

    // Exactly one reversal, so the customer is put back to owing 500 - not 1000.
    const reversals = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from customer_ledger_entry
          where ref_type = 'customer_payment' and ref_id = ${payment.id}
            and entry_type = 'REVERSAL'`,
    )
    expect(Number((reversals as unknown as { n: string }[])[0]!.n)).toBe(1)

    const balanceAfterVoid = await customerBalance(customerId)
    expect(balanceAfterVoid - balanceBeforeVoid).toBe(rs(500))
  })

  it('never allocates more against one invoice than it owes, however the collections land', async () => {
    const sold = await createSale(actor, ctx, {
      branchId,
      customerId,
      lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(1000) }],
      payments: [],
    })

    const collect = () =>
      recordCustomerPayment(actor, ctx, {
        customerId,
        branchId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1000),
        allocations: [{ saleId: sold.id, amountPaise: rs(1000) }],
      })

    const results = await Promise.allSettled([collect(), collect()])
    expectExactlyOneWinner(results, [409, 422])

    const allocated = await db.execute<{ n: string }>(
      sql`select coalesce(sum(a.amount_paise), 0)::text as n
          from customer_payment_allocation a
          join customer_payment p on p.id = a.payment_id
          where a.sale_id = ${sold.id} and p.voided_at is null`,
    )
    expect(BigInt((allocated as unknown as { n: string }[])[0]!.n)).toBeLessThanOrEqual(rs(1000))
  })

  it('bills once when the same idempotency key arrives twice at once', async () => {
    const key = `cc-idem-${stamp}`
    const submit = () =>
      createSale(actor, ctx, {
        branchId,
        customerId,
        idempotencyKey: key,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(250) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(250) }],
      })

    const results = await Promise.allSettled([submit(), submit()])

    // Both callers get an answer - the point of the key is that a retry is
    // safe, so neither should see an error.
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      id: number
      invoiceNumber: string
    }>[]
    const why = results
      .filter((r) => r.status === 'rejected')
      .map((r) => String((r as PromiseRejectedResult).reason))
      .join('; ')
    expect(fulfilled, `rejections: ${why}`).toHaveLength(2)
    expect(fulfilled[0]!.value.id).toBe(fulfilled[1]!.value.id)

    const rows = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from sale
          where business_id = ${businessId} and idempotency_key = ${key}`,
    )
    expect(Number((rows as unknown as { n: string }[])[0]!.n)).toBe(1)
  })

  it('restocks once when the same purchase is reversed twice at once', async () => {
    const created = await createPurchase(actor, ctx, {
      supplierId,
      branchId,
      lines: [{ productId: cableProductId, quantity: 10, unitCostPaise: rs(50) }],
    })
    const afterPurchase = (await getStock(cableProductId, branchId))!.quantity

    const reverse = () => reversePurchase(actor, ctx, created.id, 'Wrong supplier bill')
    const results = await Promise.allSettled([reverse(), reverse()])
    expectExactlyOneWinner(results, [409, 422])

    // The ten cables came off once. Twice would have taken stock the shop has.
    const after = (await getStock(cableProductId, branchId))!.quantity
    expect(after).toBe(afterPurchase - 10)

    // And the supplier was credited for the bill once, not twice.
    const reversals = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from supplier_ledger_entry
          where ref_type = 'purchase' and ref_id = ${created.id}
            and entry_type = 'REVERSAL'`,
    )
    expect(Number((reversals as unknown as { n: string }[])[0]!.n)).toBe(1)
  })

  /*
   * An identifier is claimed by the device holding it, and that claim is a
   * partial unique index rather than a check in the service - precisely so
   * this race cannot write two live units carrying one IMEI. The service check
   * reads the same state both transactions see, so on its own both would pass.
   */
  it('registers one device when the same IMEI is booked in twice at once', async () => {
    const contested = String(35_900_000_000_000 + (Date.now() % 1_000_000) * 10)
    const book = () =>
      createPurchase(actor, ctx, {
        supplierId,
        branchId,
        lines: [
          {
            productId: phoneProductId,
            quantity: 1,
            unitCostPaise: rs(10000),
            mainType: 'NEW',
            identifiers: [contested],
          },
        ],
      })

    const results = await Promise.allSettled([book(), book()])
    expectExactlyOneWinner(results, [409, 422])

    // Exactly one device holds the number, and it is the only one at all.
    const rows = await db
      .select()
      .from(schema.deviceIdentifier)
      .where(eq(schema.deviceIdentifier.value, contested))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.releasedAt).toBeNull()
  })

  it('never pays one supplier bill twice over', async () => {
    /*
     * Unlike a customer receipt, a supplier payment takes no document number -
     * so it never touched the sequence row whose FOR UPDATE happens to
     * serialise collections. Two payments against the same bill really could
     * both read it as fully outstanding and both allocate the lot.
     */
    const created = await createPurchase(actor, ctx, {
      supplierId,
      branchId,
      lines: [{ productId: cableProductId, quantity: 4, unitCostPaise: rs(250) }],
    })

    const pay = () =>
      recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1000),
        allocations: [{ purchaseId: created.id, amountPaise: rs(1000) }],
      })

    const results = await Promise.allSettled([pay(), pay()])
    expectExactlyOneWinner(results, [409, 422])

    const allocated = await db.execute<{ n: string }>(
      sql`select coalesce(sum(a.amount_paise), 0)::text as n
          from supplier_payment_allocation a
          join supplier_payment p on p.id = a.payment_id
          where a.purchase_id = ${created.id} and p.voided_at is null`,
    )
    expect(BigInt((allocated as unknown as { n: string }[])[0]!.n)).toBe(rs(1000))
  })

  it('closes a day once when two people press Close together', async () => {
    const businessDate = businessDateFor()
    const close = () =>
      closeDay(actor, ctx, { branchId, businessDate, countedCashPaise: rs(0) })

    const results = await Promise.allSettled([close(), close()])
    expectExactlyOneWinner(results, [409])

    const rows = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from daily_closing
          where branch_id = ${branchId} and business_date = ${businessDate}
            and voided_at is null`,
    )
    expect(Number((rows as unknown as { n: string }[])[0]!.n)).toBe(1)
  })
})
