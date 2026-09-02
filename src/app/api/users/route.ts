import { createUserSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createUser, listUsers } from '@/server/services/user.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'user.view', branchFrom: 'none' }, async ({ user }) =>
  listUsers(user),
)

export const POST = route(
  { permission: 'user.manage', branchFrom: 'none', schema: createUserSchema },
  async ({ user, body, ctx }) => {
    const ctxAudit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createUser(user, ctxAudit, body)
  },
)
