import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { createCategory, createProduct } from '@/server/services/product.service'
import { createParty } from '@/server/services/party.service'
import { increaseStock } from '@/server/services/stock.service'
import { createSale, getSale, listSales } from '@/server/services/sale.service'
import {
  branchDues,
  customerBalance,
  customerDues,
  customerStatement,
  saleReceivedPaise,
} from '@/server/services/customer-ledger.service'
import {
  getCustomerPayment,
  openSalesForCustomer,
  recordCustomerPayment,
  voidCustomerPayment,
} from '@/server/services/customer-payment.service'
import type { AuthUser } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/db/audit'
import { clearCustomerCredit, clearMoney, databaseAvailable, withAppendOnlySuspended } from './setup'

const available = await databaseAvailable()
const suite = available ? describe : describe.skip

suite('M5 customer credit and collections (database-backed)', () => {
  const stamp = Date.now()
  let businessId: number
  let branchA: number
  let branchB: number
  let customerId: number
  let cableProductId: number
  let cashMethodId: number
  let upiMethodId: number
  let actor: AuthUser
  let ctx: AuditContext
  const rs = (n: number) => BigInt(Math.round(n * 100))
  const day = 86_400_000

  /** A bill left wholly or partly unpaid — the thing M5 exists to manage. */
  async function creditSale(totalRupees: number, paidRupees = 0, opts: { dueDate?: Date; soldAt?: Date } = {}) {
    return createSale(actor, ctx, {
      branchId: branchA,
      customerId,
      lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(totalRupees) }],
      payments: paidRupees > 0 ? [{ paymentMethodId: cashMethodId, amountPaise: rs(paidRupees) }] : [],
      dueDate: opts.dueDate,
      soldAt: opts.soldAt,
    })
  }

  beforeAll(async () => {
    businessId = (
      await db.insert(schema.business).values({ name: `M5 Test ${stamp}` }).returning()
    )[0]!.id
    ;[branchA, branchB] = (
      await db
        .insert(schema.branch)
        .values([
          { businessId, code: `M5A${stamp}`.slice(0, 12), name: 'M5 Branch A' },
          { businessId, code: `M5B${stamp}`.slice(0, 12), name: 'M5 Branch B' },
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

    actor = {
      id: 0,
      businessId,
      name: 'M5 Tester',
      email: 'm5@example.local',
      roleId: 0,
      permissions: new Set(['inventory.view_cost']),
      branchIds: [branchA, branchB],
      canViewAllBranches: true,
    }
    ctx = { actor: null, businessId, branchId: branchA }

    customerId = (await createParty(actor, ctx, 'customer', { name: `Debtor ${stamp}` })).id
    const cables = await createCategory(actor, ctx, { name: 'M5 Cables', isSerialised: false })
    cableProductId = (await createProduct(actor, ctx, { name: 'M5 Cable', categoryId: cables.id })).id
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId: branchA, quantity: 10_000, movement: 'PURCHASE' },
    )
    await increaseStock(
      { businessId },
      { productId: cableProductId, branchId: branchB, quantity: 10_000, movement: 'PURCHASE' },
    )
  })

  afterAll(async () => {
    if (!available) return
    // Cleaned explicitly rather than swallowed with a catch: a teardown that
    // silently fails leaves the development database filling up with tenants.
    await withAppendOnlySuspended(async () => {
      await clearMoney(businessId)
      await clearCustomerCredit(businessId)
      await db.execute(`delete from sale_payment where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.execute(`delete from sale_item where sale_id in
        (select id from sale where business_id = ${businessId})`)
      await db.delete(schema.sale).where(eq(schema.sale.businessId, businessId))
      await db.execute(`delete from stock_ledger where business_id = ${businessId}`)
      await db.delete(schema.branchStock).where(eq(schema.branchStock.productId, cableProductId))
      await db
        .delete(schema.documentSequence)
        .where(eq(schema.documentSequence.businessId, businessId))
      await db.delete(schema.product).where(eq(schema.product.businessId, businessId))
      await db.delete(schema.category).where(eq(schema.category.businessId, businessId))
      await db.delete(schema.customer).where(eq(schema.customer.businessId, businessId))
      await db.delete(schema.paymentMethod).where(eq(schema.paymentMethod.businessId, businessId))
      await db.execute(`delete from audit_log where business_id = ${businessId}`)
      await db.delete(schema.branch).where(eq(schema.branch.businessId, businessId))
      await db.delete(schema.business).where(eq(schema.business.id, businessId))
    })
  })

  describe('a credit sale opens an account', () => {
    it('posts the bill and the counter payment, leaving the balance owing', async () => {
      const before = await customerBalance(customerId)
      const { id } = await creditSale(1000, 400)

      // Gross in, counter payment out: the account shows 600 more owing.
      expect((await customerBalance(customerId)) - before).toBe(rs(600))
      expect(await saleReceivedPaise(id)).toBe(rs(400))
      expect((await getSale(actor, id)).paymentStatus).toBe('PARTIAL')
    })

    it('gives an unpaid bill a due date from the business default', async () => {
      const soldAt = new Date()
      const { id } = await creditSale(500, 0, { soldAt })
      const { sale } = await getSale(actor, id)
      expect(sale.dueDate).not.toBeNull()
      // The seeded default is 30 days.
      const days = Math.round((sale.dueDate!.getTime() - soldAt.getTime()) / day)
      expect(days).toBe(30)
    })

    it('a fully paid bill carries no credit terms at all', async () => {
      const { id } = await creditSale(300, 300)
      const { sale, paymentStatus } = await getSale(actor, id)
      expect(paymentStatus).toBe('PAID')
      expect(sale.dueDate).toBeNull()
    })

    it('a walk-in posts nothing to any account', async () => {
      const before = await db
        .select()
        .from(schema.customerLedgerEntry)
        .where(eq(schema.customerLedgerEntry.businessId, businessId))
      await createSale(actor, ctx, {
        branchId: branchA,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(100) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(100) }],
      })
      const after = await db
        .select()
        .from(schema.customerLedgerEntry)
        .where(eq(schema.customerLedgerEntry.businessId, businessId))
      expect(after.length).toBe(before.length)
    })
  })

  describe('collecting payment', () => {
    it('three partial payments settle a credit sale and flip it to Paid', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Settler ${stamp}` })).id
      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(900) }],
        payments: [],
      })
      expect((await getSale(actor, id)).paymentStatus).toBe('UNPAID')

      for (const amount of [300, 300, 300]) {
        await recordCustomerPayment(actor, ctx, {
          customerId: buyer,
          branchId: branchA,
          paymentMethodId: cashMethodId,
          amountPaise: rs(amount),
        })
      }

      // FR-7.4: settled in full, and the account is square.
      expect((await getSale(actor, id)).paymentStatus).toBe('PAID')
      expect(await customerBalance(buyer)).toBe(0n)
      expect(await openSalesForCustomer(actor, buyer)).toHaveLength(0)
    })

    it('allocates oldest invoice first', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Fifo ${stamp}` })).id
      const older = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(200) }],
        payments: [],
        soldAt: new Date(Date.now() - 10 * day),
      })
      const newer = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(200) }],
        payments: [],
        soldAt: new Date(),
      })

      await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(200),
      })

      expect((await getSale(actor, older.id)).paymentStatus).toBe('PAID')
      expect((await getSale(actor, newer.id)).paymentStatus).toBe('UNPAID')
    })

    it('records the collecting branch, which need not be the selling branch', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Roamer ${stamp}` })).id
      // Sold at A...
      const { id: saleId } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(700) }],
        payments: [],
      })
      // ...collected at B (PRD FR-7.5).
      const { id: paymentId } = await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchB,
        paymentMethodId: upiMethodId,
        amountPaise: rs(700),
      })

      const receipt = await getCustomerPayment(actor, paymentId)
      expect(receipt.payment.branchId).toBe(branchB)
      expect((await getSale(actor, saleId)).sale.branchId).toBe(branchA)

      // Both branches appear in the ledger, each against its own movement.
      const entries = await db
        .select()
        .from(schema.customerLedgerEntry)
        .where(eq(schema.customerLedgerEntry.customerId, buyer))
      expect(entries.find((e) => e.entryType === 'SALE')!.branchId).toBe(branchA)
      expect(entries.find((e) => e.entryType === 'PAYMENT')!.branchId).toBe(branchB)
    })

    it('refuses to allocate more than an invoice owes', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Over ${stamp}` })).id
      const { id } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(100) }],
        payments: [],
      })
      await expect(
        recordCustomerPayment(actor, ctx, {
          customerId: buyer,
          branchId: branchA,
          paymentMethodId: cashMethodId,
          amountPaise: rs(500),
          allocations: [{ saleId: id, amountPaise: rs(500) }],
        }),
      ).rejects.toThrow(/more than the invoice still owes/i)
    })

    it('keeps unallocated money as an advance on the account', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Advance ${stamp}` })).id
      const { id: paymentId } = await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(250),
      })
      // Nothing owed, so nothing to allocate: they are in credit.
      expect(await customerBalance(buyer)).toBe(rs(-250))
      const receipt = await getCustomerPayment(actor, paymentId)
      expect(receipt.allocatedPaise).toBe(0n)
      expect(receipt.advancePaise).toBe(rs(250))
    })

    it('refuses a zero or negative collection', async () => {
      await expect(
        recordCustomerPayment(actor, ctx, {
          customerId,
          branchId: branchA,
          paymentMethodId: cashMethodId,
          amountPaise: 0n,
        }),
      ).rejects.toThrow(/more than zero/i)
    })

    it('numbers receipts gaplessly under concurrency', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Rapid ${stamp}` })).id
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          recordCustomerPayment(actor, ctx, {
            customerId: buyer,
            branchId: branchA,
            paymentMethodId: cashMethodId,
            amountPaise: rs(10),
          }),
        ),
      )
      const numbers = results.map((r) => r.receiptNumber)
      expect(new Set(numbers).size).toBe(25)
      const counters = numbers
        .map((n) => Number(n.slice(n.lastIndexOf('-') + 1)))
        .sort((a, b) => a - b)
      expect(counters).toEqual(Array.from({ length: 25 }, (_, i) => counters[0]! + i))
    })
  })

  describe('voiding a receipt', () => {
    it('puts the debt back and reopens the invoice', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Bounce ${stamp}` })).id
      const { id: saleId } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(400) }],
        payments: [],
      })
      const { id: paymentId } = await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(400),
      })
      expect((await getSale(actor, saleId)).paymentStatus).toBe('PAID')

      await voidCustomerPayment(actor, ctx, paymentId, 'Cheque bounced')

      // A voided receipt settles nothing, so the bill is owing again.
      expect((await getSale(actor, saleId)).paymentStatus).toBe('UNPAID')
      expect(await customerBalance(buyer)).toBe(rs(400))
    })

    it('refuses to void twice', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Twice ${stamp}` })).id
      const { id } = await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(50),
      })
      await voidCustomerPayment(actor, ctx, id, 'Mistake')
      await expect(voidCustomerPayment(actor, ctx, id, 'Again')).rejects.toThrow(/already voided/i)
    })
  })

  describe('the ledger is the only truth', () => {
    it('is append-only in the database, not merely in code', async () => {
      await expect(
        db.execute(`update customer_ledger_entry set amount_paise = 0
                    where business_id = ${businessId}`),
      ).rejects.toThrow(/append-only/i)
      await expect(
        db.execute(`delete from customer_ledger_entry where business_id = ${businessId}`),
      ).rejects.toThrow(/append-only/i)
    })

    it('every customer balance equals their outstanding recomputed from invoices', async () => {
      // The M5 acceptance criterion, checked across all the test data at once.
      const customers = await db
        .select({ id: schema.customer.id })
        .from(schema.customer)
        .where(eq(schema.customer.businessId, businessId))

      for (const c of customers) {
        const ledger = await customerBalance(c.id)
        const open = await openSalesForCustomer(actor, c.id)
        const fromInvoices = open.reduce((sum, s) => sum + s.owingPaise, 0n)
        // They agree unless the customer is in credit, where the ledger goes
        // negative and there are simply no open invoices to sum.
        expect(ledger > 0n ? ledger : 0n).toBe(fromInvoices)
      }
    })

    it('the statement runs a balance that ends where the ledger does', async () => {
      const { lines, closingBalancePaise } = await customerStatement(actor, customerId)
      expect(closingBalancePaise).toBe(await customerBalance(customerId))
      expect(lines.at(-1)?.balancePaise).toBe(closingBalancePaise)
    })
  })

  describe('dues and aging (FR-7.6)', () => {
    it('places each invoice in the right bucket by its own age', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Aged ${stamp}` })).id
      const now = new Date()
      // Four bills, one per bucket, dated by their due dates.
      const plan: [number, number][] = [
        [3, 100],
        [20, 200],
        [45, 300],
        [90, 400],
      ]
      for (const [daysAgo, amount] of plan) {
        await createSale(actor, ctx, {
          branchId: branchA,
          customerId: buyer,
          lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(amount) }],
          payments: [],
          soldAt: new Date(now.getTime() - daysAgo * day),
          dueDate: new Date(now.getTime() - daysAgo * day),
        })
      }

      const { rows } = await customerDues(actor, {}, now)
      const mine = rows.find((r) => r.customerId === buyer)!
      expect(mine.buckets['0-7']).toBe(rs(100))
      expect(mine.buckets['8-30']).toBe(rs(200))
      expect(mine.buckets['31-60']).toBe(rs(300))
      expect(mine.buckets['60+']).toBe(rs(400))
      expect(mine.balancePaise).toBe(rs(1000))
      expect(mine.openInvoiceCount).toBe(4)
    })

    it('counts only what is past its due date as overdue', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Future ${stamp}` })).id
      const now = new Date()
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(600) }],
        payments: [],
        dueDate: new Date(now.getTime() + 14 * day),
      })

      const { rows } = await customerDues(actor, {}, now)
      const mine = rows.find((r) => r.customerId === buyer)!
      expect(mine.balancePaise).toBe(rs(600))
      // Owed, but not yet late.
      expect(mine.overduePaise).toBe(0n)

      const overdue = await customerDues(actor, { overdueOnly: true }, now)
      expect(overdue.rows.find((r) => r.customerId === buyer)).toBeUndefined()
    })

    it('leaves settled customers out of the dues list entirely', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Square ${stamp}` })).id
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(150) }],
        payments: [{ paymentMethodId: cashMethodId, amountPaise: rs(150) }],
      })
      const { rows } = await customerDues(actor)
      expect(rows.find((r) => r.customerId === buyer)).toBeUndefined()
    })

    it('the bucket totals add up to the overall total', async () => {
      const { rows, totals, totalPaise } = await customerDues(actor)
      const summed = Object.values(totals).reduce((a, b) => a + b, 0n)
      expect(summed).toBe(totalPaise)
      expect(rows.reduce((sum, r) => sum + r.balancePaise, 0n)).toBe(totalPaise)
    })

    it('a later collection removes the invoice from the dues list', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Cleared ${stamp}` })).id
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(800) }],
        payments: [],
      })
      expect((await customerDues(actor)).rows.find((r) => r.customerId === buyer)).toBeDefined()

      await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(800),
      })
      expect((await customerDues(actor)).rows.find((r) => r.customerId === buyer)).toBeUndefined()
    })
  })

  describe('branch-wise reporting (FR-7.6)', () => {
    const wholePeriod = () => ({
      from: new Date(Date.now() - 365 * day),
      to: new Date(Date.now() + day),
    })

    it('a payment at Branch B against a Branch A sale lands in both figures', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Cross ${stamp}` })).id
      // Billed at A, so A carries the debt...
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(1000) }],
        payments: [],
      })

      const before = await branchDues(actor, wholePeriod())
      const aBefore = before.rows.find((r) => r.branchId === branchA)!
      const bBefore = before.rows.find((r) => r.branchId === branchB)

      // ...paid at B, so B carries the cash (PRD FR-7.5).
      await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchB,
        paymentMethodId: cashMethodId,
        amountPaise: rs(1000),
      })

      const after = await branchDues(actor, wholePeriod())
      const aAfter = after.rows.find((r) => r.branchId === branchA)!
      const bAfter = after.rows.find((r) => r.branchId === branchB)!

      // A is owed 1000 less; A collected nothing.
      expect(aBefore.outstandingPaise - aAfter.outstandingPaise).toBe(rs(1000))
      expect(aAfter.collectedPaise).toBe(aBefore.collectedPaise)

      // B collected 1000; B's own outstanding is untouched.
      expect(bAfter.collectedPaise - (bBefore?.collectedPaise ?? 0n)).toBe(rs(1000))
      expect(bAfter.outstandingPaise).toBe(bBefore?.outstandingPaise ?? 0n)
    })

    it('branch outstanding adds up to the customer-wise total', async () => {
      const byBranch = await branchDues(actor, wholePeriod())
      const byCustomer = await customerDues(actor)
      expect(byBranch.totalOutstandingPaise).toBe(byCustomer.totalPaise)
    })

    it('a voided receipt stops counting as collected', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Unpick ${stamp}` })).id
      await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(500) }],
        payments: [],
      })
      const { id } = await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(500),
      })
      const withReceipt = await branchDues(actor, wholePeriod())
      const collectedBefore = withReceipt.rows.find((r) => r.branchId === branchA)!.collectedPaise

      await voidCustomerPayment(actor, ctx, id, 'Bounced')

      const afterVoid = await branchDues(actor, wholePeriod())
      const a = afterVoid.rows.find((r) => r.branchId === branchA)!
      expect(collectedBefore - a.collectedPaise).toBe(rs(500))
      // And the debt is back against the branch that raised the bill.
      expect(a.outstandingPaise).toBeGreaterThanOrEqual(rs(500))
    })

    it('ignores collections outside the period asked for', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Window ${stamp}` })).id
      await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(90),
      })
      // A window that closed yesterday cannot contain a payment taken now.
      const past = await branchDues(actor, {
        from: new Date(Date.now() - 10 * day),
        to: new Date(Date.now() - day),
      })
      const a = past.rows.find((r) => r.branchId === branchA)
      expect(a?.collectedPaise ?? 0n).toBe(0n)
    })
  })

  describe('the sales list agrees with the ledger', () => {
    it('a bill settled by a later receipt shows PAID in the list, not just the detail', async () => {
      const buyer = (await createParty(actor, ctx, 'customer', { name: `Listed ${stamp}` })).id
      const { id, invoiceNumber } = await createSale(actor, ctx, {
        branchId: branchA,
        customerId: buyer,
        lines: [{ productId: cableProductId, quantity: 1, unitPricePaise: rs(350) }],
        payments: [],
      })
      await recordCustomerPayment(actor, ctx, {
        customerId: buyer,
        branchId: branchA,
        paymentMethodId: cashMethodId,
        amountPaise: rs(350),
      })

      const listed = await listSales(actor, { search: invoiceNumber, page: 1, pageSize: 10 })
      expect(listed.rows[0]!.paymentStatus).toBe('PAID')
      expect((await getSale(actor, id)).paymentStatus).toBe('PAID')

      // And the PAID filter must find it, since the filter and the display
      // use the same expression.
      const filtered = await listSales(actor, {
        search: invoiceNumber,
        paymentStatus: 'PAID',
        page: 1,
        pageSize: 10,
      })
      expect(filtered.total).toBe(1)
    })
  })
})
