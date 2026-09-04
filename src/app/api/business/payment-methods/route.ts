import { paymentMethodSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { listPaymentMethods, upsertPaymentMethod } from '@/server/services/business.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'business.view', branchFrom: 'none' }, ({ user }) =>
  listPaymentMethods(user),
)

export const POST = route(
  { permission: 'business.manage', branchFrom: 'none', schema: paymentMethodSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return upsertPaymentMethod(user, audit, body)
  },
)
