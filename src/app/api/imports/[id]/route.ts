import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { commitImport, getImport, validateImport } from '@/server/services/import.service'
import { AppError, route } from '@/server/http'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('validate'),
    columnMap: z.record(z.string(), z.string()),
  }),
  z.object({ action: z.literal('commit') }),
])

export const GET = route(
  {
    permission: 'product.manage',
    branchFrom: 'none',
    schema: z.object({ errorsOnly: z.coerce.boolean().optional() }),
  },
  ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid import id.', 400)
    return getImport(user, id, { errorsOnly: body.errorsOnly })
  },
)

export const PATCH = route(
  { permission: 'product.manage', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid import id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)

    return body.action === 'validate'
      ? validateImport(user, id, body.columnMap)
      : commitImport(user, audit, id)
  },
)
