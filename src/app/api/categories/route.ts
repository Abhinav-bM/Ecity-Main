import { categorySchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createCategory, listCategories } from '@/server/services/product.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'product.view', branchFrom: 'none' }, ({ user }) =>
  listCategories(user),
)

export const POST = route(
  { permission: 'product.manage', branchFrom: 'none', schema: categorySchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createCategory(user, audit, body)
  },
)
