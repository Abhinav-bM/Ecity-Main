import { brandSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createBrand, listBrands } from '@/server/services/product.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'product.view', branchFrom: 'none' }, ({ user }) =>
  listBrands(user),
)

export const POST = route(
  { permission: 'product.manage', branchFrom: 'none', schema: brandSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createBrand(user, audit, body)
  },
)
