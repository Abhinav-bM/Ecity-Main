import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { updateCategory } from '@/server/services/product.service'
import { AppError, route } from '@/server/http'

const schema = z.object({
  name: z.string().trim().min(1, 'A category needs a name.').max(60).optional(),
  isActive: z.boolean().optional(),
  /**
   * Only accepted while the category has no products. How its items are
   * tracked decides whether they carry identifiers at all, so changing it
   * afterwards would reinterpret stock that already exists.
   */
  isSerialised: z.boolean().optional(),
  identifierType: z.enum(['IMEI', 'SERIAL', 'NONE']).optional(),
})

export const PATCH = route(
  { permission: 'product.manage', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid category id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await updateCategory(user, audit, id, body)
    return { ok: true }
  },
)
