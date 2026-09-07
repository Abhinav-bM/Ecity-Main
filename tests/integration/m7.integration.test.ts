import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { increaseStock } from '@/server/services/stock.service'
import { createSale, getSale } from '@/server/services/sale.service'
import { recordCustomerPayment } from '@/server/services/customer-payment.service'
import { recordSupplierPayment } from '@/server/services/supplier-payment.service'
import { createReturn } from '@/server/services/return.service'
import { createExpense, listExpenses, voidExpense } from '@/server/services/expense.service'
import {
  businessDateFor,
  expectedCashPaise,
  getDrawerDay,
  listAccounts,
} from '@/server/services/cash.service'
import { createAccount, reconcile, transfer } from '@/server/services/account.service'
import { closeDay, daySummary, listClosings, voidClosing } from '@/server/services/closing.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M7 cash drawer, expenses, accounts and daily closing (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let customerId: number
  let supplierId: number
  let cableProductId: number
  let cashMethodId: number
  let upiMethodId: number
  let rentCategoryId: number
  let actor: AuthUser
  let staff: AuthUser
  let ctx: AuditContext
  const today = businessDateFor()
  const rs = (n: number) => BigInt(Math.round(n * 100))

  async function sellForCash(rupees: number, branchId = branchA) {
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId, quantity: 1, movement: 'PURCHASE' },
    )
    return createSale(actor, ctx, {
      branchId,
      lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(rupees) }],
      payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(rupees) }],
    })
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M7 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M7A${stamp}`.slice(0, 12), name: 'M7 Branch A' },
          { businessId, code: `M7B${stamp}`.slice(0, 12), name: 'M7 Branch B' },
        ])
        .returning()
    ).map((b) => b.id) as [number, number]

    const methods = await db
      .insert(schema.paymentMethod)
      .values([
        { businessId, code: 'CASH', name: 'Cash', type: 'CASH', affectsCashDrawer: true },
        { businessId, code: 'UPI', name: 'UPI', type: 'UPI' },
      ])
      .returning()
    cashMethodId = methods[0]!.id
    upiMethodId = methods[1]!.id

    rentCategoryId = (
      await db.insert(schema.expenseCategory).values({ businessId, name: 'Rent' }).returning()
    )[0]!.id

    actor = {
      id: 0,
      businessId,
      name: 'M7 Tester',
      email: 'm7@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost', 'closing.correct']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    // Without closing.correct - used to prove a closed day refuses new money.
    staff = { ...actor, permissions: new Set<string>() as AuthUser['permissions'] }
    ctx = { actor: null, businessId, branchId: branchA }

    customerId = (await createParty(actor, ctx, 'customer', { name: `M7 Buyer ${stamp}` })).id
    supplierId = (await createParty(actor, ctx, 'supplier', { name: `M7 Supplier ${stamp}` })).id
    const cables = await createCategory(actor, ctx, { name: 'M7 Cables', isSerialised: false })
    cableProductId = (await createProduct(actor, ctx, { name: 'M7 Cable', categoryId: cables.id }))
      .id
  })

  afterAll(async () => {
    if (!available) return
    await withAppendOnlySuspended(async () => {
      const devices = await db
        .select({ id: schema.deviceUnit.id })
        .from(schema.deviceUnit)
        .where(eq(schema.deviceUnit.businessId, businessId))
      const ids = devices.map((d) => d.id)
      await clearMoney(businessId)
      await clearCustomerCredit(businessId)
      await db.execute(`delete from refund where business_id = ${businessId}`)
      await db.execute(`delete from return_item where return_id in
        (select id from sales_return where business_id = ${businessId})`)
      await db.execute(`delete from sales_return where business_id = ${businessId}`)
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      if (ids.length) {
        await db.execute(`delete from device_event where device_id in (${ids.join(',')})`)
        await db
          .delete(schema.deviceIdentifier)
          .where(inArray(schema.deviceIdentifier.deviceId, ids))
      }
      await db.delete(schema.deviceUnit).where(eq(schema.deviceUnit.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db
        .delete(schema.documentSequence)
        .where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.expenseCategory).where(eq(schema.expenseCategory.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      // A supplier payment posts to the supplier ledger, which has a foreign
      // key back to supplier - clear it before the suppliers go.
      await db.execute(`delete from supplier_payment_allocation where payment_id in
        (select id from supplier_payment where business_id = ${businessId})`)
      await db.execute(`delete from supplier_payment where business_id = ${businessId}`)
      await db.execute(`delete from supplier_ledger_entry where business_id = ${businessId}`)
      await db.delete(schema.supplier).where(eq(schema.supplier.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('the drawer sees every rupee (FR-11.2)', () => {
    it('a cash sale puts money in the till and a UPI sale does not', async () => {
      const before = await expectedCashPaise(branchA, today)

      await sellForCash(500)
      expect(await expectedCashPaise(branchA, today)).toBe(before + rs(500))

      // UPI never touches the drawer, which is the whole reason the payment
      // method carries `affectsCashDrawer`.
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 1, movement: 'PURCHASE' },
      )
      await createSale(actor, ctx, {
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(700) }],
        payments: [{ paymentMethodId: upiMethodId, amountPaise: rs(700) }],
      })
      expect(await expectedCashPaise(branchA, today)).toBe(before + rs(500))
    })

    it('a credit collection, an expense and a refund all move it the right way', async () => {
      const start = await expectedCashPaise(branchA, today)

      // A customer clears their tab in cash: money in.
      await increaseStock(
        { businessId },
        { productId: cableProductId, branchId: branchA, quantity: 1, movement: 'PURCHASE' },
      )
      const credit = await createSale(actor, ctx, {
        branchId: branchA,
        customerId,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(1000) }],
        payments: [],
      })
      expect(await expectedCashPaise(branchA, today)).toBe(start)

      await recordCustomerPayment(actor, ctx, {
        customerId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1000),
      })
      expect(await expectedCashPaise(branchA, today)).toBe(start + rs(1000))

      // An expense: money out.
      await createExpense(actor, ctx, {
        branchId: branchA,
        categoryId: rentCategoryId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(300),
        description: 'Tea and transport',
      })
      expect(await expectedCashPaise(branchA, today)).toBe(start + rs(700))

      // A refund on that bill: money out again.
      const detail = await getSale(actor, credit.id)
      await createReturn(actor, ctx, {
        saleId: credit.id,
        branchId: branchA,
        lines: [{ saleItemId: detail.items[0]!.id, quantity: 1 }],
        refund: { method: 'PAYMENT_METHOD', paymentMethodId: cashMethodId },
      })
      expect(await expectedCashPaise(branchA, today)).toBe(start + rs(700) - rs(1000))
    })

    it('paying a supplier in cash takes it out of the till', async () => {
      const before = await expectedCashPaise(branchA, today)
      await recordSupplierPayment(actor, ctx, {
        supplierId,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1500),
      })
      expect(await expectedCashPaise(branchA, today)).toBe(before - rs(1500))
    })

    it('each branch has its own drawer', async () => {
      const a = await expectedCashPaise(branchA, today)
      await sellForCash(2500, branchB)
      // Branch B's takings must not appear in branch A's till.
      expect(await expectedCashPaise(branchA, today)).toBe(a)
      expect(await expectedCashPaise(branchB, today)).toBeGreaterThanOrEqual(rs(2500))
    })

    it('shows the movements behind the total, not just the total', async () => {
      const day = await getDrawerDay(actor, branchA, today)
      expect(day.movements.length).toBeGreaterThan(0)
      expect(day.expectedPaise).toBe(day.openingPaise + day.inPaise - day.outPaise)
    })
  })

  describe('expenses (FR-10.1 – FR-10.3)', () => {
    it('is voided rather than deleted, and the money comes back', async () => {
      const before = await expectedCashPaise(branchA, today)
      const { id } = await createExpense(actor, ctx, {
        branchId: branchA,
        categoryId: rentCategoryId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(250),
      })
      expect(await expectedCashPaise(branchA, today)).toBe(before - rs(250))

      await voidExpense(actor, ctx, id, 'Entered twice')
      expect(await expectedCashPaise(branchA, today)).toBe(before)

      // The row survives; it is not deleted.
      const listed = await listExpenses(actor, { page: 1, pageSize: 100, includeVoided: true })
      const found = listed.rows.find((e) => e.id === id)
      expect(found?.voidedAt).not.toBeNull()
      expect(found?.voidReason).toBe('Entered twice')

      // ...and a voided expense is not counted in the total spent.
      const live = await listExpenses(actor, { page: 1, pageSize: 100 })
      expect(live.rows.some((e) => e.id === id)).toBe(false)
    })

    it('refuses a void without a reason', async () => {
      const { id } = await createExpense(actor, ctx, {
        branchId: branchA,
        categoryId: rentCategoryId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(100),
      })
      await expect(voidExpense(actor, ctx, id, '   ')).rejects.toThrow(/why/i)
    })
  })

  describe('accounts (FR-12.1 – FR-12.4)', () => {
    it('a transfer moves both sides or neither', async () => {
      const from = await createAccount(actor, ctx, {
        name: `M7 Bank ${stamp}`,
        type: 'BANK',
        openingBalancePaise: rs(50000),
      })
      const to = await createAccount(actor, ctx, {
        name: `M7 UPI ${stamp}`,
        type: 'UPI',
      })

      await transfer(actor, ctx, {
        fromAccountId: from.id,
        toAccountId: to.id,
        amountPaise: rs(12000),
      })

      const accounts = await listAccounts(actor)
      expect(accounts.find((a) => a.id === from.id)?.balancePaise).toBe(rs(38000))
      expect(accounts.find((a) => a.id === to.id)?.balancePaise).toBe(rs(12000))
    })

    it('refuses a transfer to the same account', async () => {
      const acc = await createAccount(actor, ctx, { name: `M7 Same ${stamp}`, type: 'BANK' })
      await expect(
        transfer(actor, ctx, {
          fromAccountId: acc.id,
          toAccountId: acc.id,
          amountPaise: rs(100),
        }),
      ).rejects.toThrow(/different accounts/i)
    })

    it('reconciling records the statement figure without moving money', async () => {
      const acc = await createAccount(actor, ctx, {
        name: `M7 Recon ${stamp}`,
        type: 'BANK',
        openingBalancePaise: rs(10000),
      })
      // The statement says 9,500 but the books say 10,000: a real 500 gap.
      const { differencePaise } = await reconcile(actor, ctx, acc.id, rs(9500))
      expect(differencePaise).toBe(-rs(500))

      const found = (await listAccounts(actor)).find((a) => a.id === acc.id)!
      // The balance has NOT been silently adjusted to match the statement.
      expect(found.balancePaise).toBe(rs(10000))
      expect(found.unreconciledPaise).toBe(-rs(500))
    })
  })

  describe('closing the day (FR-13.1 – FR-13.4)', () => {
    const closeDate = '2020-06-01'

    it('a shortage is computed, attributed and stamped', async () => {
      // A day of its own, so the other tests' movements cannot disturb it.
      const drawer = await db
        .insert(schema.cashDrawerDay)
        .values({ businessId, branchId: branchB, businessDate: closeDate, openingPaise: rs(1000) })
        .returning()
      await db.insert(schema.cashMovement).values({
        businessId,
        drawerDayId: drawer[0]!.id,
        branchId: branchB,
        movement: 'SALE',
        amountPaise: rs(4000),
      })

      const summary = await daySummary(actor, branchB, closeDate)
      expect(summary.expectedCashPaise).toBe(rs(5000))

      // Counted 200 short.
      const { cashDifferencePaise } = await closeDay(actor, ctx, {
        branchId: branchB,
        businessDate: closeDate,
        countedCashPaise: rs(4800),
      })
      expect(cashDifferencePaise).toBe(-rs(200))

      const closed = await daySummary(actor, branchB, closeDate)
      expect(closed.closing?.countedCashPaise).toBe(rs(4800))
      expect(closed.closing?.expectedCashPaise).toBe(rs(5000))
      expect(closed.drawerStatus).toBe('CLOSED')
    })

    it('refuses to close the same day twice', async () => {
      await expect(
        closeDay(actor, ctx, {
          branchId: branchB,
          businessDate: closeDate,
          countedCashPaise: rs(4800),
        }),
      ).rejects.toThrow(/already closed/i)
    })

    it('refuses new money in a closed day without authorisation', async () => {
      await expect(
        createExpense(staff, ctx, {
          branchId: branchB,
          categoryId: rentCategoryId,
          paymentMethodId: cashMethodId,
          amountPaise: rs(100),
          businessDate: closeDate,
        }),
      ).rejects.toThrow(/closed/i)
    })

    it('a correction is allowed with authorisation, and the signed figures do not move', async () => {
      await createExpense(actor, ctx, {
        branchId: branchB,
        categoryId: rentCategoryId,
        paymentMethodId: cashMethodId,
        amountPaise: rs(700),
        businessDate: closeDate,
        description: 'Bill found later',
      })

      const after = await daySummary(actor, branchB, closeDate)
      /*
       * PRD OQ-5, the whole point. The signature says 5,000 was expected and
       * that never changes. The movements now come to 4,300. The gap is the
       * correction, and it is surfaced rather than smoothed over.
       */
      expect(after.closing?.expectedCashPaise).toBe(rs(5000))
      expect(after.closing?.countedCashPaise).toBe(rs(4800))
      expect(after.closing?.cashDifferencePaise).toBe(-rs(200))
      expect(after.expectedCashPaise).toBe(rs(4300))
      expect(after.correctedAfterClose).toBe(true)
    })

    it('reopens a day closed too early, but not once a later day has closed', async () => {
      const early = '2020-06-02'
      const later = '2020-06-03'
      for (const [d, opening] of [
        [early, rs(0)],
        [later, rs(0)],
      ] as const) {
        await db
          .insert(schema.cashDrawerDay)
          .values({ businessId, branchId: branchA, businessDate: d, openingPaise: opening })
      }

      const first = await closeDay(actor, ctx, {
        branchId: branchA,
        businessDate: early,
        countedCashPaise: 0n,
      })
      // Nothing later closed yet, so reopening is allowed.
      await voidClosing(actor, ctx, first.id, 'Closed before the last sale')
      const reopened = await daySummary(actor, branchA, early)
      expect(reopened.closing).toBeNull()
      expect(reopened.drawerStatus).toBe('OPEN')

      // Close it again, then close a later day.
      const second = await closeDay(actor, ctx, {
        branchId: branchA,
        businessDate: early,
        countedCashPaise: 0n,
      })
      await closeDay(actor, ctx, {
        branchId: branchA,
        businessDate: later,
        countedCashPaise: 0n,
      })

      // Now the earlier day is history and must stay put.
      await expect(voidClosing(actor, ctx, second.id, 'Changed my mind')).rejects.toThrow(
        /no longer be reopened/i,
      )
    })

    it('the voided closing is kept, not deleted', async () => {
      const history = await listClosings(actor, { branchId: branchA, page: 1, pageSize: 100 })
      expect(history.rows.some((c) => c.voidedAt !== null)).toBe(true)
    })

    it('will not close a day that has not happened yet', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      await expect(
        closeDay(actor, ctx, {
          branchId: branchA,
          businessDate: tomorrow,
          countedCashPaise: 0n,
        }),
      ).rejects.toThrow(/has not happened/i)
    })

    it("the next day's drawer opens with what was actually counted", async () => {
      const day = '2021-03-10'
      const next = '2021-03-11'
      await db
        .insert(schema.cashDrawerDay)
        .values({ businessId, branchId: branchB, businessDate: day, openingPaise: rs(2000) })
      await closeDay(actor, ctx, {
        branchId: branchB,
        businessDate: day,
        // Counted 1,900 against 2,000 expected - the drawer really holds 1,900.
        countedCashPaise: rs(1900),
      })

      const tomorrow = await getDrawerDay(actor, branchB, next)
      expect(tomorrow.openingPaise).toBe(rs(1900))
    })
  })
})
