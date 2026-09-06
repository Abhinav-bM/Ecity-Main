import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { markSoldExternally } from '@/server/services/sale.service'
import { AppError, route } from '@/server/http'

const schema = z.object({ note: z.string().trim().max(300).optional() })

export const POST = route(
  { permission: 'sale.create', branchFrom: 'none', schema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid device id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await markSoldExternally(user, audit, id, body.note)
    return { ok: true }
  },
)
