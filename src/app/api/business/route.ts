import { businessProfileSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { getBusiness, updateBusiness } from '@/server/services/business.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'business.view', branchFrom: 'none' }, ({ user }) =>
  getBusiness(user),
)

export const PATCH = route(
  { permission: 'business.manage', branchFrom: 'none', schema: businessProfileSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await updateBusiness(user, audit, body)
    return { ok: true }
  },
)
