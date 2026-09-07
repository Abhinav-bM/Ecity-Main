import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { voidClosing } from '@/server/services/closing.service'
import { AppError, route } from '@/server/http'

const schema = z.object({
  reason: z.string().trim().min(1, 'Say why the day is being reopened.').max(300),
})

/**
 * Reopen a day (PRD OQ-5). The closing is voided, not deleted — that a day was
 * closed and reopened is part of the record. Refused once a later day for the
 * branch has been closed.
 */
export const DELETE = route(
  { permission: 'closing.void', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid closing id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await voidClosing(user, audit, id, body.reason)
    return { ok: true }
  },
)
