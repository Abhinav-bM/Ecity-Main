import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { updateBrand } from '@/server/services/product.service'
import { AppError, route } from '@/server/http'

const schema = z.object({
  name: z.string().trim().min(1, 'A brand needs a name.').max(60).optional(),
  isActive: z.boolean().optional(),
})

export const PATCH = route(
  { permission: 'product.manage', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid brand id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await updateBrand(user, audit, id, body)
    return { ok: true }
  },
)
