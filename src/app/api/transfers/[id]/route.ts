import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  approveTransfer,
  cancelTransfer,
  dispatchTransfer,
  receiveTransfer,
} from '@/server/services/transfer.service'
import { requirePermission } from '@/server/auth/permissions'
import { AppError, route } from '@/server/http'

/**
 * PRD FR-3.6. One endpoint per step of the lifecycle, because each is a
 * different decision by a different person — and each carries its own
 * permission. The state machine itself is enforced in the service.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('dispatch') }),
  z.object({
    action: z.literal('receive'),
    lines: z
      .array(
        z.object({
          transferItemId: z.coerce.number().int().positive(),
          receivedQuantity: z.coerce.number().int().min(0),
        }),
      )
      .default([]),
    discrepancyNotes: z.string().trim().max(500).optional(),
    /** Scanned at the destination but not on this transfer. */
    unexpectedIdentifiers: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().min(1, 'Say why it is being cancelled.').max(300),
  }),
])

/**
 * Seeing a transfer is the floor; each action then asserts its own permission,
 * because approving stock out of a branch and receiving it in are different
 * jobs done by different people.
 */
export const PATCH = route(
  { permission: 'transfer.view', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid transfer id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)

    switch (body.action) {
      case 'approve':
        requirePermission(user, 'transfer.approve')
        await approveTransfer(user, audit, id)
        return { ok: true }
      case 'dispatch':
        requirePermission(user, 'transfer.approve')
        await dispatchTransfer(user, audit, id)
        return { ok: true }
      case 'receive':
        requirePermission(user, 'transfer.receive')
        return receiveTransfer(
          user,
          audit,
          id,
          body.lines,
          body.discrepancyNotes,
          body.unexpectedIdentifiers,
        )
      case 'cancel':
        requirePermission(user, 'transfer.cancel')
        await cancelTransfer(user, audit, id, body.reason)
        return { ok: true }
    }
  },
)
