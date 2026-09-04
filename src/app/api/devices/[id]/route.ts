import { getDevice } from '@/server/services/device.service'
import { AppError, route } from '@/server/http'

export const GET = route(
  { permission: 'inventory.view', branchFrom: 'none' },
  ({ user, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid device id.', 400)
    return getDevice(user, id)
  },
)
