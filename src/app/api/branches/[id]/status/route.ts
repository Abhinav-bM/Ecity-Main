import { branchStatusSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { setBranchStatus } from '@/server/services/branch.service'
import { AppError, route } from '@/server/http'

export const PATCH = route(
  { permission: 'branch.manage', branchFrom: 'none', schema: branchStatusSchema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid branch id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await setBranchStatus(user, audit, id, body.status)
    return { ok: true }
  },
)
