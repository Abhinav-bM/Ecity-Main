import { reversePurchaseSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { reversePurchase } from '@/server/services/purchase.service'
import { AppError, route } from '@/server/http'

export const POST = route(
  { permission: 'purchase.reverse', branchFrom: 'none', schema: reversePurchaseSchema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid purchase id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await reversePurchase(user, audit, id, body.reason)
    return { ok: true }
  },
)
