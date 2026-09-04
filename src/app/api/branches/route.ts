import { branchSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  createBranch,
  listAccessibleBranches,
  listBranches,
} from '@/server/services/branch.service'
import { hasPermission } from '@/server/auth/permissions'
import { route } from '@/server/http'

/**
 * Two shapes from one endpoint: `?manage=1` returns the full management list
 * (including deactivated branches), anything else returns just the branches
 * this user may act in — which is what the header switcher needs.
 */
export const GET = route({ permission: 'branch.view', branchFrom: 'none' }, async ({ req, user }) => {
  const manage = new URL(req.url).searchParams.get('manage') === '1'
  if (manage && hasPermission(user, 'branch.manage')) return listBranches(user)
  return listAccessibleBranches(user)
})

export const POST = route(
  { permission: 'branch.manage', branchFrom: 'none', schema: branchSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createBranch(user, audit, body)
  },
)
