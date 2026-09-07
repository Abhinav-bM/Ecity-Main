import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { voidExpense } from '@/server/services/expense.service'
import { AppError, route } from '@/server/http'

const schema = z.object({ reason: z.string().trim().min(1, 'Say why it is being voided.').max(300) })

/**
 * An expense is voided, never deleted (PRD FR-10.3). DELETE is the honest verb
 * for the user's intent; the row survives and the money is posted back.
 */
export const DELETE = route(
  { permission: 'expense.void', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid expense id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await voidExpense(user, audit, id, body.reason)
    return { ok: true }
  },
)
