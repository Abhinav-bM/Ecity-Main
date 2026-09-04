import { auditContextFromRequest } from '@/server/db/audit'
import { deleteAttachment } from '@/server/services/attachment.service'
import { AppError, route } from '@/server/http'

export const DELETE = route(
  { permission: 'attachment.upload', branchFrom: 'none' },
  async ({ user, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid attachment id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await deleteAttachment(user, audit, id)
    return { ok: true }
  },
)
