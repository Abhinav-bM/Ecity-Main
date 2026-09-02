import { upsertRoleSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createRole, listPermissionCatalogue, listRoles } from '@/server/services/role.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'role.view', branchFrom: 'none' }, async ({ user }) => {
  const [roles, permissions] = await Promise.all([listRoles(user), listPermissionCatalogue()])
  return { roles, permissions }
})

export const POST = route(
  { permission: 'role.manage', branchFrom: 'none', schema: upsertRoleSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createRole(user, audit, body)
  },
)
