import { updateUserSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { getUser, updateUser } from '@/server/services/user.service'
import { AppError, route } from '@/server/http'

function idFrom(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid user id.', 400)
  return id
}

export const GET = route(
  { permission: 'user.view', branchFrom: 'none' },
  async ({ user, params }) => getUser(user, idFrom(params)),
)

export const PATCH = route(
  { permission: 'user.manage', branchFrom: 'none', schema: updateUserSchema },
  async ({ user, body, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await updateUser(user, audit, idFrom(params), body)
    return { ok: true }
  },
)
