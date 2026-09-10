import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import {
  account,
  accountTransaction,
  cashMovement,
  customer,
  customerLedgerEntry,
  importJob,
  supplier,
  supplierLedgerEntry,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { postCustomerLedgerEntry } from './customer-ledger.service'
import { postLedgerEntry as postSupplierLedgerEntry } from './supplier-ledger.service'
import { increaseStock } from './stock.service'
import { openDrawerDay } from './cash.service'

/**
 * Opening balances (PRD FR-34.1 – FR-34.3).
 *
 * The day a shop starts using ECITY it already has stock on the shelf, cash in
 * the till and people who owe it money. None of that has a document, so it
 * cannot arrive through the ordinary path - but it must land in the same
 * ledgers, or every figure built on them starts wrong.
 *
 * Everything here posts through the normal services with an explicit OPENING
 * marker, so a balance is always traceable to the day it was declared rather
 * than appearing as an unexplained number.
 */

/** Opening stock for accessories, counted on the day you start. */
/*
 * One row at a time.
 *
 * The batch entry points below take a whole screen's worth and write one audit
 * line for it; a file import brings thousands of rows and writes its own
 * audit line for the batch. Both go through these, so an opening figure looks
 * identical whether it was typed or uploaded.
 */

/** One product's count on the day the shop starts. */
export async function postOpeningStockLine(
  actor: AuthUser,
  input: { branchId: number; productId: number; quantity: number; asOf: string },
) {
  await increaseStock(
    {
      businessId: actor.businessId,
      actorId: actor.id,
      refType: 'opening_balance',
      note: `Opening stock as at ${input.asOf}`,
      occurredAt: new Date(`${input.asOf}T00:00:00+05:30`),
    },
    {
      productId: input.productId,
      branchId: input.branchId,
      quantity: input.quantity,
      // Its own movement type, so the movement report shows it as the
      // starting point rather than as a purchase nobody can find a bill for.
      movement: 'OPENING',
    },
  )
}

/** What one customer already owed. */
export async function postOpeningCustomerDue(
  actor: AuthUser,
  input: { customerId: number; amountPaise: bigint; asOf: string; note?: string },
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
) {
  const exists = (
    await tx
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, input.customerId), eq(customer.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!exists) throw notFound('Customer')

  /*
   * Declared once, and only once.
   *
   * The ledger is append-only, so a second opening entry cannot be taken back
   * - it simply doubles what the customer owes, for good. Nothing stopped a
   * second save, or the same file being imported twice, and the screen that
   * says how much is owed would have been wrong from then on with no way to
   * see why. Correcting a figure that is already in is a payment or a credit
   * note, both of which leave a trail.
   */
  const already = (
    await tx
      .select({ id: customerLedgerEntry.id })
      .from(customerLedgerEntry)
      .where(
        and(
          eq(customerLedgerEntry.customerId, input.customerId),
          eq(customerLedgerEntry.entryType, 'OPENING'),
        ),
      )
      .limit(1)
  )[0]
  if (already) {
    throw conflict('This customer already has an opening balance. Adjust it with a payment or a credit note.')
  }

  await postCustomerLedgerEntry(tx, {
    businessId: actor.businessId,
    customerId: input.customerId,
    entryType: 'OPENING',
    amountPaise: input.amountPaise,
    refType: 'opening_balance',
    note: input.note ?? `Owed as at ${input.asOf}`,
    actorId: actor.id,
    occurredAt: new Date(`${input.asOf}T00:00:00+05:30`),
  })
}

/** What the shop already owed one supplier. */
export async function postOpeningSupplierDue(
  actor: AuthUser,
  input: { supplierId: number; amountPaise: bigint; asOf: string; note?: string },
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
) {
  const exists = (
    await tx
      .select({ id: supplier.id })
      .from(supplier)
      .where(and(eq(supplier.id, input.supplierId), eq(supplier.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!exists) throw notFound('Supplier')

  // As for a customer: append-only, so a second one doubles the debt.
  const already = (
    await tx
      .select({ id: supplierLedgerEntry.id })
      .from(supplierLedgerEntry)
      .where(
        and(
          eq(supplierLedgerEntry.supplierId, input.supplierId),
          eq(supplierLedgerEntry.entryType, 'OPENING'),
        ),
      )
      .limit(1)
  )[0]
  if (already) {
    throw conflict('This supplier already has an opening balance. Adjust it with a payment or a debit note.')
  }

  await postSupplierLedgerEntry(tx, {
    businessId: actor.businessId,
    supplierId: input.supplierId,
    entryType: 'OPENING',
    amountPaise: input.amountPaise,
    refType: 'opening_balance',
    note: input.note ?? `Owed as at ${input.asOf}`,
    actorId: actor.id,
    occurredAt: new Date(`${input.asOf}T00:00:00+05:30`),
  })
}

export async function openingStock(
  actor: AuthUser,
  ctx: AuditContext,
  input: { branchId: number; asOf: string; lines: { productId: number; quantity: number }[] },
) {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(input.branchId)) throw notFound('Branch')
  if (input.lines.length === 0) throw new AppError('Nothing to record.', 422, 'NO_LINES')

  let applied = 0

  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue
    await postOpeningStockLine(actor, {
      branchId: input.branchId,
      productId: line.productId,
      quantity: line.quantity,
      asOf: input.asOf,
    })
    applied += 1
  }

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'opening_balance',
    entityId: input.branchId,
    summary: `Opening stock for ${applied} product(s) as at ${input.asOf}`,
  })

  return { applied }
}

/**
 * Cash already in the till, and money already in the accounts.
 *
 * Posted as movements rather than written into a balance column, because
 * every balance in the system is the sum of its movements (docs/03 §4.2) -
 * an opening figure that bypassed that would be the one number nobody could
 * prove.
 */
export async function openingCash(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    asOf: string
    branches: { branchId: number; amountPaise: bigint }[]
    accounts: { accountId: number; amountPaise: bigint }[]
  },
) {
  const scope = branchScope(actor, null)
  const occurredAt = new Date(`${input.asOf}T00:00:00+05:30`)

  /*
   * One transaction for the whole declaration.
   *
   * These used to be posted one at a time. A shop declaring three branches
   * where the second already had a figure kept the first branch's cash and
   * refused the rest - and the retry then failed on the first branch too,
   * leaving no way forward that did not need a developer. Either the whole
   * opening position is taken, or none of it is.
   */
  await db.transaction(async (tx) => {
    for (const row of input.branches) {
      if (row.amountPaise === 0n) continue
      if (scope !== null && !scope.includes(row.branchId)) throw notFound('Branch')

      const existing = (
        await tx
          .select({ id: cashMovement.id })
          .from(cashMovement)
          .where(
            and(
              eq(cashMovement.businessId, actor.businessId),
              eq(cashMovement.branchId, row.branchId),
              eq(cashMovement.movement, 'OPENING'),
              eq(cashMovement.refType, 'opening_balance'),
            ),
          )
          .limit(1)
      )[0]
      if (existing) {
        throw conflict('This branch already has an opening cash figure. Adjust it instead.')
      }

      const day = await openDrawerDay(tx, {
        businessId: actor.businessId,
        branchId: row.branchId,
        businessDate: input.asOf,
      })
      await tx.insert(cashMovement).values({
        businessId: actor.businessId,
        drawerDayId: day.id,
        branchId: row.branchId,
        movement: 'OPENING',
        amountPaise: row.amountPaise,
        refType: 'opening_balance',
        note: `Cash in hand as at ${input.asOf}`,
        occurredAt,
        createdBy: actor.id,
      })
    }

    for (const row of input.accounts) {
      if (row.amountPaise === 0n) continue
      const acc = (
        await tx
          .select({ id: account.id, branchId: account.branchId })
          .from(account)
          .where(and(eq(account.id, row.accountId), eq(account.businessId, actor.businessId)))
          .limit(1)
      )[0]
      if (!acc) throw notFound('Account')

      // The same guard the till gets. Without it an account could be given
      // its opening balance twice over and quietly hold double.
      const existing = (
        await tx
          .select({ id: accountTransaction.id })
          .from(accountTransaction)
          .where(
            and(
              eq(accountTransaction.accountId, acc.id),
              eq(accountTransaction.movement, 'OPENING'),
              eq(accountTransaction.refType, 'opening_balance'),
            ),
          )
          .limit(1)
      )[0]
      if (existing) {
        throw conflict('This account already has an opening balance. Adjust it instead.')
      }

      await tx.insert(accountTransaction).values({
        businessId: actor.businessId,
        accountId: acc.id,
        branchId: acc.branchId,
        movement: 'OPENING',
        amountPaise: row.amountPaise,
        businessDate: input.asOf,
        refType: 'opening_balance',
        note: `Balance as at ${input.asOf}`,
        occurredAt,
        createdBy: actor.id,
      })
    }
  })

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'opening_balance',
    entityId: 0,
    summary: `Opening cash and account balances as at ${input.asOf}`,
  })

  return { branches: input.branches.length, accounts: input.accounts.length }
}

/**
 * What customers already owed, and what the shop already owed suppliers.
 *
 * Posted as OPENING ledger entries, so the dues screens, the aging buckets
 * and the dashboards all pick them up without knowing they were imported.
 */
export async function openingDues(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    asOf: string
    customers?: { customerId: number; amountPaise: bigint }[]
    suppliers?: { supplierId: number; amountPaise: bigint }[]
  },
) {
  let posted = 0

  await db.transaction(async (tx) => {
    for (const row of input.customers ?? []) {
      if (row.amountPaise === 0n) continue
      await postOpeningCustomerDue(
        actor,
        { customerId: row.customerId, amountPaise: row.amountPaise, asOf: input.asOf },
        tx,
      )
      posted += 1
    }

    for (const row of input.suppliers ?? []) {
      if (row.amountPaise === 0n) continue
      await postOpeningSupplierDue(
        actor,
        { supplierId: row.supplierId, amountPaise: row.amountPaise, asOf: input.asOf },
        tx,
      )
      posted += 1
    }
  })

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'opening_balance',
    entityId: 0,
    summary: `Opening dues for ${posted} party(ies) as at ${input.asOf}`,
  })

  return { posted }
}

/** What has already been declared, so a screen can say "done" rather than ask twice. */
export async function openingSummary(actor: AuthUser) {
  const [cash, accounts, stock, customerDues, supplierDues] = await Promise.all([
    db
      .select({ n: sql<string>`count(*)` })
      .from(cashMovement)
      .where(
        and(
          eq(cashMovement.businessId, actor.businessId),
          eq(cashMovement.refType, 'opening_balance'),
        ),
      ),
    db
      .select({ n: sql<string>`count(*)` })
      .from(accountTransaction)
      .where(
        and(
          eq(accountTransaction.businessId, actor.businessId),
          eq(accountTransaction.refType, 'opening_balance'),
        ),
      ),
    db
      .select({ n: sql<string>`count(*)` })
      .from(importJob)
      .where(
        and(eq(importJob.businessId, actor.businessId), eq(importJob.kind, 'OPENING_STOCK')),
      ),
    db.execute<{ n: string }>(
      sql`select count(*)::text as n from customer_ledger_entry
          where business_id = ${actor.businessId} and entry_type = 'OPENING'`,
    ),
    db.execute<{ n: string }>(
      sql`select count(*)::text as n from supplier_ledger_entry
          where business_id = ${actor.businessId} and entry_type = 'OPENING'`,
    ),
  ])

  const count = (rows: unknown) => Number((rows as { n: string }[])[0]?.n ?? 0)

  return {
    cashDeclared: Number(cash[0]?.n ?? 0),
    accountsDeclared: Number(accounts[0]?.n ?? 0),
    stockImports: Number(stock[0]?.n ?? 0),
    customerDuesDeclared: count(customerDues),
    supplierDuesDeclared: count(supplierDues),
  }
}
