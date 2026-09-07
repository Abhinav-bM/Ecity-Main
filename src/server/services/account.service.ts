import { and, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { account, accountTransaction } from '@/server/db/schema'
import { writeAudit, diff, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { accountBalancePaise, businessDateFor } from './cash.service'

/**
 * Bank, UPI and card accounts (PRD FR-12.1 – FR-12.4).
 *
 * Balances are derived from `account_transaction`, which is append-only, so a
 * reconciliation is always provable from the movements behind it.
 */

export type AccountInput = {
  name: string
  type: (typeof account.$inferInsert)['type']
  branchId?: number | null
  accountNumber?: string
  bankName?: string
  ifsc?: string
  upiId?: string
  openingBalancePaise?: bigint
}

export async function createAccount(
  actor: AuthUser,
  ctx: AuditContext,
  input: AccountInput,
): Promise<{ id: number }> {
  const name = input.name.trim()
  if (!name) throw new AppError('An account needs a name.', 422, 'NO_NAME')

  const clash = (
    await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.businessId, actor.businessId), eq(account.name, name)))
      .limit(1)
  )[0]
  if (clash) throw conflict('An account with that name already exists.')

  const created = (
    await db
      .insert(account)
      .values({
        businessId: actor.businessId,
        branchId: input.branchId ?? null,
        name,
        type: input.type,
        accountNumber: input.accountNumber?.trim() || null,
        bankName: input.bankName?.trim() || null,
        ifsc: input.ifsc?.trim().toUpperCase() || null,
        upiId: input.upiId?.trim() || null,
        openingBalancePaise: input.openingBalancePaise ?? 0n,
      })
      .returning({ id: account.id })
  )[0]!

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'account',
    entityId: created.id,
    summary: `Account ${name} added`,
  })

  return created
}

export async function updateAccount(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  input: Partial<AccountInput> & { isActive?: boolean },
): Promise<void> {
  const before = (
    await db
      .select()
      .from(account)
      .where(and(eq(account.id, id), eq(account.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!before) throw notFound('Account')

  /*
   * The opening balance is deliberately not editable here. It is the starting
   * point every derived balance is built on, so changing it would silently
   * move every figure the account has ever shown. Correct it with an
   * ADJUSTMENT transaction instead, which is visible in the ledger.
   */
  const values = {
    name: input.name?.trim() ?? before.name,
    type: input.type ?? before.type,
    branchId: input.branchId === undefined ? before.branchId : input.branchId,
    accountNumber: input.accountNumber?.trim() || null,
    bankName: input.bankName?.trim() || null,
    ifsc: input.ifsc?.trim().toUpperCase() || null,
    upiId: input.upiId?.trim() || null,
    isActive: input.isActive ?? before.isActive,
    updatedAt: new Date(),
  }

  await db.update(account).set(values).where(eq(account.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'account',
    entityId: id,
    summary: `Account ${values.name} updated`,
    changes: diff(before, values),
  })
}

/**
 * Move money between two accounts (FR-12.3).
 *
 * Both legs are written in one transaction and share a `transferGroup`, so a
 * transfer that took money out of one account without putting it into the
 * other cannot exist.
 */
export async function transfer(
  actor: AuthUser,
  ctx: AuditContext,
  input: {
    fromAccountId: number
    toAccountId: number
    amountPaise: bigint
    businessDate?: string
    note?: string
  },
): Promise<void> {
  if (input.amountPaise <= 0n) {
    throw new AppError('A transfer must be more than zero.', 422, 'BAD_AMOUNT')
  }
  if (input.fromAccountId === input.toAccountId) {
    throw new AppError('Choose two different accounts.', 422, 'SAME_ACCOUNT')
  }

  const businessDate = input.businessDate ?? businessDateFor()

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: account.id, name: account.name, branchId: account.branchId })
      .from(account)
      .where(eq(account.businessId, actor.businessId))
    const from = rows.find((a) => a.id === input.fromAccountId)
    const to = rows.find((a) => a.id === input.toAccountId)
    if (!from || !to) throw notFound('Account')

    const scope = branchScope(actor, null)
    for (const a of [from, to]) {
      if (scope !== null && a.branchId !== null && !scope.includes(a.branchId)) {
        throw notFound('Account')
      }
    }

    const group = `tr_${Date.now()}_${input.fromAccountId}_${input.toAccountId}`
    const occurredAt = new Date()

    await tx.insert(accountTransaction).values([
      {
        businessId: actor.businessId,
        accountId: from.id,
        branchId: from.branchId,
        movement: 'TRANSFER_OUT',
        amountPaise: -input.amountPaise,
        businessDate,
        transferGroup: group,
        note: input.note?.trim() || `To ${to.name}`,
        occurredAt,
        createdBy: actor.id,
      },
      {
        businessId: actor.businessId,
        accountId: to.id,
        branchId: to.branchId,
        movement: 'TRANSFER_IN',
        amountPaise: input.amountPaise,
        businessDate,
        transferGroup: group,
        note: input.note?.trim() || `From ${from.name}`,
        occurredAt,
        createdBy: actor.id,
      },
    ])

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'account',
        entityId: from.id,
        summary: `Transferred ${input.amountPaise} from ${from.name} to ${to.name}`,
      },
      tx,
    )
  })
}

/**
 * Confirm what the statement actually says (FR-12.4).
 *
 * This records the statement figure and the moment it was checked. It does not
 * move any money: if the two disagree, the difference is real and wants an
 * explanation, not an adjustment applied automatically.
 */
export async function reconcile(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  statementBalancePaise: bigint,
): Promise<{ differencePaise: bigint }> {
  const row = (
    await db
      .select({ id: account.id, name: account.name })
      .from(account)
      .where(and(eq(account.id, id), eq(account.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Account')

  const balance = await accountBalancePaise(id)
  const difference = statementBalancePaise - balance

  await db
    .update(account)
    .set({
      reconciledBalancePaise: statementBalancePaise,
      reconciledAt: new Date(),
      reconciledBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(account.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'account',
    entityId: id,
    summary:
      `Reconciled ${row.name} — statement ${statementBalancePaise}, ` +
      `books ${balance}, difference ${difference}`,
  })

  return { differencePaise: difference }
}

/** An ADJUSTMENT is how a real difference gets corrected, visibly. */
export async function adjust(
  actor: AuthUser,
  ctx: AuditContext,
  input: { accountId: number; amountPaise: bigint; note: string; businessDate?: string },
): Promise<void> {
  if (input.amountPaise === 0n) {
    throw new AppError('An adjustment of nothing changes nothing.', 422, 'BAD_AMOUNT')
  }
  if (!input.note.trim()) throw new AppError('Say what the adjustment is for.', 422, 'NO_NOTE')

  const row = (
    await db
      .select({ id: account.id, branchId: account.branchId })
      .from(account)
      .where(and(eq(account.id, input.accountId), eq(account.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Account')

  await db.insert(accountTransaction).values({
    businessId: actor.businessId,
    accountId: row.id,
    branchId: row.branchId,
    movement: 'ADJUSTMENT',
    amountPaise: input.amountPaise,
    businessDate: input.businessDate ?? businessDateFor(),
    note: input.note.trim(),
    createdBy: actor.id,
  })

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: 'account',
    entityId: row.id,
    summary: `Adjusted by ${input.amountPaise} — ${input.note.trim()}`,
  })
}
