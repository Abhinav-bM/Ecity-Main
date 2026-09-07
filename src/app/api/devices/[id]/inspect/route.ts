import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { inspectDevice } from '@/server/services/return.service'
import { AppError, route } from '@/server/http'

const schema = z.object({
  grade: z.enum(['AVAILABLE', 'USED', 'DAMAGED', 'REPAIR_REQUIRED']),
  notes: z.string().trim().max(500).optional(),
})

/** PRD FR-8.3. Releasing a handset back to sellable is not the counter's call. */
export const POST = route(
  { permission: 'return.inspect', branchFrom: 'none', schema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid device id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await inspectDevice(user, audit, { deviceId: id, grade: body.grade, notes: body.notes })
    return { ok: true }
  },
)
