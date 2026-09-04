import { listLowStock } from '@/server/services/product.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'inventory.view', branchFrom: 'none' }, ({ user, ctx }) =>
  listLowStock(user, ctx.activeBranchId),
)
