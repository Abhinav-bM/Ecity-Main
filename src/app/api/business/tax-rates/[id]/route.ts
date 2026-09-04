import { setActiveSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { setTaxRateActive } from '@/server/services/business.service'
import { AppError, route } from '@/server/http'

export const PATCH = route(
  { permission: 'business.manage', branchFrom: 'none', schema: setActiveSchema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await setTaxRateActive(user, audit, id, body.isActive)
    return { ok: true }
  },
)
