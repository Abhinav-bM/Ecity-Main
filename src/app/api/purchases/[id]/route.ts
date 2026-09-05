import { getPurchase } from '@/server/services/purchase.service'
import { AppError, route } from '@/server/http'

export const GET = route({ permission: 'purchase.view', branchFrom: 'none' }, ({ user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid purchase id.', 400)
  return getPurchase(user, id)
})
