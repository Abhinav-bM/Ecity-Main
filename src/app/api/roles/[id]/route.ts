import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { deleteRole, updateRolePermissions } from '@/server/services/role.service'
import { AppError, route } from '@/server/http'

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).default([]),
})

function idFrom(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid role id.', 400)
  return id
}

export const PATCH = route(
  { permission: 'role.manage', branchFrom: 'none', schema: patchSchema },
  async ({ user, body, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await updateRolePermissions(user, audit, idFrom(params), body)
    return { ok: true }
  },
)

export const DELETE = route(
  { permission: 'role.manage', branchFrom: 'none' },
  async ({ user, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await deleteRole(user, audit, idFrom(params))
    return { ok: true }
  },
)
