import { branchSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { getBranch, updateBranch } from '@/server/services/branch.service'
import { AppError, route } from '@/server/http'

function idFrom(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid branch id.', 400)
  return id
}

export const GET = route({ permission: 'branch.view', branchFrom: 'none' }, ({ user, params }) =>
  getBranch(user, idFrom(params)),
)

export const PATCH = route(
  { permission: 'branch.manage', branchFrom: 'none', schema: branchSchema },
  async ({ user, body, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await updateBranch(user, audit, idFrom(params), body)
    return { ok: true }
  },
)
