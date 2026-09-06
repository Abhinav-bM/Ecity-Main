import { getSale } from '@/server/services/sale.service'
import { AppError, route } from '@/server/http'

export const GET = route({ permission: 'sale.view', branchFrom: 'none' }, ({ user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid sale id.', 400)
  return getSale(user, id)
})
