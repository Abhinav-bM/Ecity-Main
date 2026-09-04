import { taxRateSchema, toBasisPoints } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { listTaxRates, upsertTaxRate } from '@/server/services/business.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'business.view', branchFrom: 'none' }, ({ user }) =>
  listTaxRates(user),
)

export const POST = route(
  { permission: 'business.manage', branchFrom: 'none', schema: taxRateSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return upsertTaxRate(user, audit, {
      id: body.id,
      name: body.name,
      rateBasisPoints: toBasisPoints(body.ratePercent),
      isDefault: body.isDefault,
    })
  },
)
