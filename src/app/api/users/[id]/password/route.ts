import { z } from 'zod'
import { passwordSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { resetUserPassword } from '@/server/services/user.service'
import { AppError, route } from '@/server/http'

const schema = z.object({ password: passwordSchema })

export const POST = route(
  { permission: 'user.manage', branchFrom: 'none', schema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid user id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await resetUserPassword(user, audit, id, body.password)
    return { ok: true }
  },
)
