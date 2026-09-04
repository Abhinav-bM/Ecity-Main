import { minQuantitySchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { setMinQuantity } from '@/server/services/product.service'
import { route } from '@/server/http'

export const POST = route(
  { permission: 'product.manage', branchFrom: 'body', schema: minQuantitySchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await setMinQuantity(user, audit, body)
    return { ok: true }
  },
)
