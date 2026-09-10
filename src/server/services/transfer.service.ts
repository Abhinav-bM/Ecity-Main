import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, type DbOrTx } from '@/server/db'
import {
  appUser,
  branch,
  branchStock,
  business,
  deviceUnit,
  product,
  stockTransfer,
  transferItem,
} from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import { branchScope, type AuthUser } from '@/server/auth/permissions'
import { decreaseStock, increaseStock, setDeviceStatus } from './stock.service'
import { nextDocumentNumber } from './sequence.service'
import { assertBranchAcceptsTransactions } from './branch.service'

/**
 * Branch transfers (PRD FR-3.6, FR-3.7).
 *
 * The states exist for one reason: while stock is in transit it belongs to
 * NEITHER branch's sellable inventory. A handset that is sellable at both ends
 * of its journey gets sold twice, and the second customer is told after the
 * fact. So dispatch takes it out of the source and only receipt puts it into
 * the destination - nothing is sellable in between.
 */

export type TransferStatus = (typeof stockTransfer.$inferSelect)['status']

/**
 * The lifecycle, as data rather than scattered `if`s - the same shape as the
 * device transition table in M2, and for the same reason: it can be read, and
 * tested, in one place.
 */
const ALLOWED_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  REQUESTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_TRANSIT', 'CANCELLED'],
  // Cancelled from in transit returns the goods to the source branch.
  IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
  // Terminal. A mistake after receipt is corrected by a new transfer back, or
  // an adjustment - never by rewinding a completed movement.
  RECEIVED: [],
  CANCELLED: [],
}

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

function assertTransition(from: TransferStatus, to: TransferStatus) {
  if (!canTransition(from, to)) {
    throw conflict(`A transfer cannot go from ${from} to ${to}.`)
  }
}

async function transferSeriesFor(
  tx: DbOrTx,
  businessId: number,
  branchId: number,
): Promise<{ prefix: string; branchId: number | null }> {
  const row = (
    await tx
      .select({ branchPrefix: branch.invoicePrefix, businessPrefix: business.invoicePrefix })
      .from(branch)
      .innerJoin(business, eq(business.id, branch.businessId))
      .where(eq(branch.id, branchId))
      .limit(1)
  )[0]
  if (!row) throw notFound('Branch')

  return row.branchPrefix
    ? { prefix: `${row.branchPrefix}-TRF-`, branchId }
    : { prefix: `${row.businessPrefix}-TRF-`, branchId: null }
}

export type TransferLineInput = {
  productId: number
  /** FR-3.7. The exact handset. Null for accessories. */
  deviceId?: number | null
  quantity: number
}

export type TransferInput = {
  fromBranchId: number
  toBranchId: number
  lines: TransferLineInput[]
  notes?: string
}

/**
 * Ask for stock to move. Nothing leaves the shelf yet - a request is a request.
 */
export async function requestTransfer(
  actor: AuthUser,
  ctx: AuditContext,
  input: TransferInput,
): Promise<{ id: number; transferNumber: string }> {
  if (input.lines.length === 0) {
    throw new AppError('A transfer needs at least one line.', 422, 'NO_LINES')
  }
  if (input.fromBranchId === input.toBranchId) {
    throw new AppError('Choose two different branches.', 422, 'SAME_BRANCH')
  }
  await assertBranchAcceptsTransactions(actor, input.fromBranchId)
  await assertBranchAcceptsTransactions(actor, input.toBranchId)

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(input.fromBranchId) && !scope.includes(input.toBranchId)) {
    throw notFound('Branch')
  }

  return db.transaction(async (tx) => {
    const deviceIds = input.lines
      .map((l) => l.deviceId)
      .filter((v): v is number => typeof v === 'number')

    const devices = deviceIds.length
      ? await tx
          .select({
            id: deviceUnit.id,
            status: deviceUnit.status,
            branchId: deviceUnit.currentBranchId,
            identifier: deviceUnit.primaryIdentifier,
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

    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new AppError('Quantity must be a whole number of at least one.', 422, 'BAD_QTY')
      }
      if (line.deviceId) {
        const d = deviceById.get(line.deviceId)
        if (!d) throw notFound('Device')
        if (d.branchId !== input.fromBranchId) {
          throw new AppError(
            `${d.identifier ?? 'That device'} is not at the sending branch.`,
            422,
            'WRONG_BRANCH',
          )
        }
        if (d.status !== 'IN_STOCK') {
          throw conflict(`${d.identifier ?? 'That device'} is not available (${d.status}).`)
        }
        if (line.quantity !== 1) {
          throw new AppError('A handset moves one at a time.', 422, 'BAD_QTY')
        }
        // The same handset cannot be on two open transfers at once.
        const openElsewhere = (
          await tx
            .select({ id: transferItem.id })
            .from(transferItem)
            .innerJoin(stockTransfer, eq(stockTransfer.id, transferItem.transferId))
            .where(
              and(
                eq(transferItem.deviceId, line.deviceId),
                sql`${stockTransfer.status} in ('REQUESTED', 'APPROVED', 'IN_TRANSIT')`,
              ),
            )
            .limit(1)
        )[0]
        if (openElsewhere) {
          throw conflict(`${d.identifier ?? 'That device'} is already on another transfer.`)
        }
      }
    }

    const series = await transferSeriesFor(tx, actor.businessId, input.fromBranchId)
    const transferNumber = await nextDocumentNumber(tx, {
      businessId: actor.businessId,
      kind: 'stock_transfer',
      branchId: series.branchId,
      prefix: series.prefix,
    })

    const created = (
      await tx
        .insert(stockTransfer)
        .values({
          businessId: actor.businessId,
          transferNumber,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          notes: input.notes?.trim() || null,
          requestedBy: actor.id,
        })
        .returning({ id: stockTransfer.id })
    )[0]!

    for (const line of input.lines) {
      await tx.insert(transferItem).values({
        transferId: created.id,
        productId: line.productId,
        deviceId: line.deviceId ?? null,
        quantity: line.quantity,
      })
    }

    await writeAudit(
      ctx,
      {
        action: 'CREATE',
        entityType: 'stock_transfer',
        entityId: created.id,
        summary: `Requested ${transferNumber} — ${input.lines.length} line(s)`,
      },
      tx,
    )

    return { id: created.id, transferNumber }
  })
}

/**
 * Which end of the journey the caller has to be standing at.
 *
 * A receipt is someone at the destination confirming the goods turned up. If
 * the sending branch could sign for them, the confirmation would be worth
 * nothing - the same person who packed the box would be attesting it arrived.
 * Approving and dispatching are the sender's decision for the mirror reason.
 *
 * A user who can see every branch is exempt: they are the owner, and there is
 * nobody else to check them.
 */
function assertAtBranch(actor: AuthUser, branchId: number, doing: string) {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(branchId)) {
    throw new AppError(
      `Only someone at the ${doing} branch can do that.`,
      403,
      'WRONG_BRANCH_FOR_STEP',
    )
  }
}

/**
 * The transfer, locked for the rest of the transaction.
 *
 * Every step - approve, dispatch, receive, cancel - reads the status, checks
 * the transition is legal, and then writes. Without the lock two of those can
 * read the same status and both find their move legal: a dispatch and a cancel
 * arriving together would each move the same stock, and the row would end up
 * in whichever state committed last. Serialising them here is what makes
 * `assertTransition` an actual guarantee rather than a hopeful check.
 *
 * Every caller already runs inside a transaction and goes through this
 * function, so this is the single place it needs to happen.
 */
async function loadForChange(tx: DbOrTx, actor: AuthUser, id: number) {
  await tx.execute(
    sql`select id from stock_transfer
        where id = ${id} and business_id = ${actor.businessId}
        for update`,
  )

  const row = (
    await tx
      .select()
      .from(stockTransfer)
      .where(and(eq(stockTransfer.id, id), eq(stockTransfer.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Transfer')

  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(row.fromBranchId) && !scope.includes(row.toBranchId)) {
    throw notFound('Transfer')
  }
  return row
}

/** A manager at the sending branch agrees the stock can go. */
export async function approveTransfer(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadForChange(tx, actor, id)
    assertAtBranch(actor, row.fromBranchId, 'sending')
    assertTransition(row.status, 'APPROVED')

    await tx
      .update(stockTransfer)
      .set({ status: 'APPROVED', approvedAt: new Date(), approvedBy: actor.id, updatedAt: new Date() })
      .where(eq(stockTransfer.id, id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'stock_transfer',
        entityId: id,
        summary: `Approved ${row.transferNumber}`,
      },
      tx,
    )
  })
}

/**
 * The goods leave. This is where stock stops being sellable at the source.
 *
 * Devices go to IN_TRANSIT and accessory quantities come off the source
 * branch's count. Neither arrives anywhere until someone receives them.
 */
export async function dispatchTransfer(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadForChange(tx, actor, id)
    assertAtBranch(actor, row.fromBranchId, 'sending')
    assertTransition(row.status, 'IN_TRANSIT')

    const items = await tx
      .select()
      .from(transferItem)
      .where(eq(transferItem.transferId, id))
      .orderBy(asc(transferItem.id))

    for (const item of items) {
      if (item.deviceId) {
        await setDeviceStatus(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'stock_transfer',
            refId: id,
          },
          {
            deviceId: item.deviceId,
            expectedStatus: 'IN_STOCK',
            nextStatus: 'IN_TRANSIT',
            eventType: 'TRANSFERRED_OUT',
            branchId: row.fromBranchId,
            // It has not arrived anywhere yet, so it stays with the sender...
            toBranchId: row.fromBranchId,
            // ...but the event says where it is headed (FR-3.7).
            eventFromBranchId: row.fromBranchId,
            eventToBranchId: row.toBranchId,
            payload: { transferNumber: row.transferNumber },
          },
          tx,
        )
      } else {
        await decreaseStock(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'stock_transfer',
            refId: id,
          },
          {
            productId: item.productId,
            branchId: row.fromBranchId,
            quantity: item.quantity,
            movement: 'TRANSFER_OUT',
          },
          tx,
        )
      }
    }

    await tx
      .update(stockTransfer)
      .set({
        status: 'IN_TRANSIT',
        dispatchedAt: new Date(),
        dispatchedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(stockTransfer.id, id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'stock_transfer',
        entityId: id,
        summary: `Dispatched ${row.transferNumber} — ${items.length} line(s) left ${row.fromBranchId}`,
      },
      tx,
    )
  })
}

export type ReceiveLine = {
  transferItemId: number
  /** What actually turned up. Short of what was sent is a discrepancy. */
  receivedQuantity: number
}

/**
 * The goods arrive (FR-3.7).
 *
 * What was scanned lands at the destination. Anything short is recorded as a
 * discrepancy and the handset is marked LOST rather than quietly forgotten -
 * something that left one branch and reached no other has to be accounted for.
 */
export async function receiveTransfer(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  lines: ReceiveLine[],
  discrepancyNotes?: string,
  /**
   * Identifiers that turned up in the box but are not on the transfer.
   *
   * Recorded, never acted on. Something physically here that the system thinks
   * is elsewhere is a real problem, but moving it automatically would be
   * inventing a transfer nobody authorised - so it is written down and a
   * person deals with it.
   */
  unexpectedIdentifiers: string[] = [],
): Promise<{ hasDiscrepancy: boolean; unexpected: string[] }> {
  return db.transaction(async (tx) => {
    const row = await loadForChange(tx, actor, id)
    assertAtBranch(actor, row.toBranchId, 'receiving')
    assertTransition(row.status, 'RECEIVED')

    const items = await tx
      .select()
      .from(transferItem)
      .where(eq(transferItem.transferId, id))
      .orderBy(asc(transferItem.id))
    const byId = new Map(items.map((i) => [i.id, i]))

    const received = new Map<number, number>()
    for (const line of lines) {
      const item = byId.get(line.transferItemId)
      if (!item) throw notFound('Transfer line')
      if (line.receivedQuantity < 0 || line.receivedQuantity > item.quantity) {
        throw new AppError(
          'Received quantity must be between zero and what was sent.',
          422,
          'BAD_QTY',
        )
      }
      received.set(item.id, line.receivedQuantity)
    }

    const unexpected = unexpectedIdentifiers.map((v) => v.trim()).filter(Boolean)
    let short = false
    for (const item of items) {
      // A line nobody said anything about did not arrive.
      const got = received.get(item.id) ?? 0
      if (got < item.quantity) short = true

      if (item.deviceId) {
        if (got >= 1) {
          await setDeviceStatus(
            {
              businessId: actor.businessId,
              actorId: actor.id,
              refType: 'stock_transfer',
              refId: id,
            },
            {
              deviceId: item.deviceId,
              expectedStatus: 'IN_TRANSIT',
              nextStatus: 'IN_STOCK',
              eventType: 'TRANSFERRED_IN',
              branchId: row.toBranchId,
              toBranchId: row.toBranchId,
              eventFromBranchId: row.fromBranchId,
              eventToBranchId: row.toBranchId,
              payload: { transferNumber: row.transferNumber },
            },
            tx,
          )
        } else {
          /*
           * It left one branch and reached no other. Marking it LOST is the
           * only honest option: leaving it IN_TRANSIT on a closed transfer
           * would strand a handset in a state nothing can move it out of.
           */
          await setDeviceStatus(
            {
              businessId: actor.businessId,
              actorId: actor.id,
              refType: 'stock_transfer',
              refId: id,
              note: 'Did not arrive',
            },
            {
              deviceId: item.deviceId,
              expectedStatus: 'IN_TRANSIT',
              nextStatus: 'LOST',
              eventType: 'LOST',
              branchId: row.fromBranchId,
              eventFromBranchId: row.fromBranchId,
              // No destination: it reached nobody.
              eventToBranchId: null,
              payload: { transferNumber: row.transferNumber, intendedFor: row.toBranchId },
            },
            tx,
          )
        }
      } else if (got > 0) {
        await increaseStock(
          {
            businessId: actor.businessId,
            actorId: actor.id,
            refType: 'stock_transfer',
            refId: id,
          },
          {
            productId: item.productId,
            branchId: row.toBranchId,
            quantity: got,
            movement: 'TRANSFER_IN',
          },
          tx,
        )
      }

      await tx
        .update(transferItem)
        .set({ receivedQuantity: got })
        .where(eq(transferItem.id, item.id))
    }

    const flagged = short || unexpected.length > 0
    const notes = [
      discrepancyNotes?.trim() || (short ? 'Short on receipt' : ''),
      unexpected.length ? `Not on this transfer: ${unexpected.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' — ')

    await tx
      .update(stockTransfer)
      .set({
        status: 'RECEIVED',
        receivedAt: new Date(),
        receivedBy: actor.id,
        hasDiscrepancy: flagged,
        discrepancyNotes: flagged ? notes : null,
        updatedAt: new Date(),
      })
      .where(eq(stockTransfer.id, id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'stock_transfer',
        entityId: id,
        summary: flagged
          ? `Received ${row.transferNumber} WITH A DISCREPANCY — ${notes}`
          : `Received ${row.transferNumber} in full`,
      },
      tx,
    )

    return { hasDiscrepancy: flagged, unexpected }
  })
}

/**
 * Call it off. Available right up to receipt (FR-3.6).
 *
 * Cancelling something already in transit puts the goods back where they came
 * from - they never reached the destination, so the source is where they are.
 */
export async function cancelTransfer(
  actor: AuthUser,
  ctx: AuditContext,
  id: number,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new AppError('Say why it is being cancelled.', 422, 'NO_REASON')

  await db.transaction(async (tx) => {
    const row = await loadForChange(tx, actor, id)
    assertTransition(row.status, 'CANCELLED')

    // Only a dispatched transfer has anything to put back.
    if (row.status === 'IN_TRANSIT') {
      const items = await tx
        .select()
        .from(transferItem)
        .where(eq(transferItem.transferId, id))
        .orderBy(asc(transferItem.id))

      for (const item of items) {
        if (item.deviceId) {
          await setDeviceStatus(
            {
              businessId: actor.businessId,
              actorId: actor.id,
              refType: 'stock_transfer',
              refId: id,
              note: `Transfer cancelled: ${reason.trim()}`,
            },
            {
              deviceId: item.deviceId,
              expectedStatus: 'IN_TRANSIT',
              nextStatus: 'IN_STOCK',
              eventType: 'TRANSFERRED_IN',
              branchId: row.fromBranchId,
              toBranchId: row.fromBranchId,
              /*
               * No from-branch: it never reached the destination, so claiming
               * a journey back from there would put it somewhere it never was.
               */
              eventToBranchId: row.fromBranchId,
              payload: {
                transferNumber: row.transferNumber,
                cancelled: true,
                intendedFor: row.toBranchId,
              },
            },
            tx,
          )
        } else {
          await increaseStock(
            {
              businessId: actor.businessId,
              actorId: actor.id,
              refType: 'stock_transfer',
              refId: id,
              note: 'Transfer cancelled',
            },
            {
              productId: item.productId,
              branchId: row.fromBranchId,
              quantity: item.quantity,
              movement: 'TRANSFER_IN',
            },
            tx,
          )
        }
      }
    }

    await tx
      .update(stockTransfer)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actor.id,
        cancelReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(stockTransfer.id, id))

    await writeAudit(
      ctx,
      {
        action: 'UPDATE',
        entityType: 'stock_transfer',
        entityId: id,
        summary: `Cancelled ${row.transferNumber} — ${reason.trim()}`,
      },
      tx,
    )
  })
}

/* ------------------------------------------------------------ reading --- */

export type TransferFilters = {
  status?: TransferStatus
  branchId?: number
  search?: string
  page: number
  pageSize: number
}

export async function listTransfers(actor: AuthUser, filters: TransferFilters) {
  const conditions: SQL[] = [eq(stockTransfer.businessId, actor.businessId)]

  const scope = branchScope(actor, null)
  if (scope !== null) {
    const ids = scope.length ? scope : [-1]
    // Either end of the journey is enough to see it.
    conditions.push(
      sql`(${stockTransfer.fromBranchId} in ${ids} or ${stockTransfer.toBranchId} in ${ids})`,
    )
  }
  if (filters.status) conditions.push(eq(stockTransfer.status, filters.status))
  if (filters.branchId) {
    conditions.push(
      sql`(${stockTransfer.fromBranchId} = ${filters.branchId}
           or ${stockTransfer.toBranchId} = ${filters.branchId})`,
    )
  }
  if (filters.search?.trim()) {
    conditions.push(sql`${stockTransfer.transferNumber} ilike ${'%' + filters.search.trim() + '%'}`)
  }

  const where = and(...conditions)
  const offset = (filters.page - 1) * filters.pageSize
  const fromBranch = alias(branch, 'from_branch')
  const toBranch = alias(branch, 'to_branch')

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: stockTransfer.id,
        transferNumber: stockTransfer.transferNumber,
        status: stockTransfer.status,
        fromBranchName: fromBranch.name,
        toBranchName: toBranch.name,
        requestedAt: stockTransfer.requestedAt,
        receivedAt: stockTransfer.receivedAt,
        hasDiscrepancy: stockTransfer.hasDiscrepancy,
        lineCount: sql<number>`(
          select count(*)::int from transfer_item ti
          where ti.transfer_id = "stock_transfer"."id"
        )`,
      })
      .from(stockTransfer)
      .innerJoin(fromBranch, eq(fromBranch.id, stockTransfer.fromBranchId))
      .innerJoin(toBranch, eq(toBranch.id, stockTransfer.toBranchId))
      .where(where)
      // Newest first: the transfer you are chasing is the recent one.
      .orderBy(desc(stockTransfer.requestedAt), desc(stockTransfer.id))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ n: sql<string>`count(*)` }).from(stockTransfer).where(where),
  ])

  return { rows, total: Number(counted[0]?.n ?? 0), page: filters.page, pageSize: filters.pageSize }
}

export async function getTransfer(actor: AuthUser, id: number) {
  const fromBranch = alias(branch, 'from_branch')
  const toBranch = alias(branch, 'to_branch')

  const row = (
    await db
      .select({
        transfer: stockTransfer,
        fromBranchName: fromBranch.name,
        toBranchName: toBranch.name,
        requestedByName: appUser.name,
      })
      .from(stockTransfer)
      .innerJoin(fromBranch, eq(fromBranch.id, stockTransfer.fromBranchId))
      .innerJoin(toBranch, eq(toBranch.id, stockTransfer.toBranchId))
      .leftJoin(appUser, eq(appUser.id, stockTransfer.requestedBy))
      .where(and(eq(stockTransfer.id, id), eq(stockTransfer.businessId, actor.businessId)))
      .limit(1)
  )[0]
  if (!row) throw notFound('Transfer')

  const scope = branchScope(actor, null)
  if (
    scope !== null &&
    !scope.includes(row.transfer.fromBranchId) &&
    !scope.includes(row.transfer.toBranchId)
  ) {
    throw notFound('Transfer')
  }

  const items = await db
    .select({
      id: transferItem.id,
      productId: transferItem.productId,
      productName: product.name,
      deviceId: transferItem.deviceId,
      identifier: deviceUnit.primaryIdentifier,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
      deviceStatus: deviceUnit.status,
      quantity: transferItem.quantity,
      receivedQuantity: transferItem.receivedQuantity,
    })
    .from(transferItem)
    .innerJoin(product, eq(product.id, transferItem.productId))
    .leftJoin(deviceUnit, eq(deviceUnit.id, transferItem.deviceId))
    .where(eq(transferItem.transferId, id))
    .orderBy(asc(transferItem.id))

  return { ...row, items }
}

/** What a branch can actually send: devices in stock and accessories on hand. */
export async function sendableStock(actor: AuthUser, branchId: number, search?: string) {
  const scope = branchScope(actor, null)
  if (scope !== null && !scope.includes(branchId)) throw notFound('Branch')

  const term = search?.trim()
  const like = term ? `%${term}%` : null

  const devices = await db
    .select({
      id: deviceUnit.id,
      identifier: deviceUnit.primaryIdentifier,
      productId: deviceUnit.productId,
      productName: product.name,
      mainType: deviceUnit.mainType,
      isNewCut: deviceUnit.isNewCut,
    })
    .from(deviceUnit)
    .innerJoin(product, eq(product.id, deviceUnit.productId))
    .where(
      and(
        eq(deviceUnit.businessId, actor.businessId),
        eq(deviceUnit.currentBranchId, branchId),
        eq(deviceUnit.status, 'IN_STOCK'),
        ...(like
          ? [sql`(${deviceUnit.primaryIdentifier} ilike ${like} or ${product.name} ilike ${like})`]
          : []),
      ),
    )
    .orderBy(asc(product.name))
    .limit(25)

  const accessories = await db
    .select({
      productId: product.id,
      productName: product.name,
      quantity: branchStock.quantity,
    })
    .from(branchStock)
    .innerJoin(product, eq(product.id, branchStock.productId))
    .where(
      and(
        eq(branchStock.branchId, branchId),
        eq(product.businessId, actor.businessId),
        eq(product.isSerialised, false),
        sql`${branchStock.quantity} > 0`,
        ...(like ? [sql`${product.name} ilike ${like}`] : []),
      ),
    )
    .orderBy(asc(product.name))
    .limit(25)

  return { devices, accessories }
}
