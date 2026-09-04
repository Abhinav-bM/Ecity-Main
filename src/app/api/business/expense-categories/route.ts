import { expenseCategorySchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  createExpenseCategory,
  listExpenseCategories,
} from '@/server/services/business.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'business.view', branchFrom: 'none' }, ({ user }) =>
  listExpenseCategories(user),
)

export const POST = route(
  { permission: 'business.manage', branchFrom: 'none', schema: expenseCategorySchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createExpenseCategory(user, audit, body)
  },
)
