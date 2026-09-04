import { partyQuerySchema, partySchema, partyStatusSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  createParty,
  getParty,
  listParties,
  setPartyStatus,
  updateParty,
} from '@/server/services/party.service'
import { AppError, route } from '@/server/http'
import type { PermissionCode } from '@/lib/permissions'

/**
 * Customers and suppliers are the same endpoint shape with different tables
 * and permissions. Generating both from one place means a fix to duplicate
 * detection or search cannot land on one and miss the other.
 */
export function partyRoutes(kind: 'customer' | 'supplier') {
  const viewPermission = `${kind}.view` as PermissionCode
  const managePermission = `${kind}.manage` as PermissionCode

  const idFrom = (params: Record<string, string>) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError(`Invalid ${kind} id.`, 400)
    return id
  }

  return {
    list: route(
      { permission: viewPermission, branchFrom: 'none', schema: partyQuerySchema },
      ({ user, body }) => listParties(user, kind, body),
    ),
    create: route(
      { permission: managePermission, branchFrom: 'none', schema: partySchema },
      async ({ user, body, ctx }) => {
        const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
        return createParty(user, audit, kind, body)
      },
    ),
    get: route({ permission: viewPermission, branchFrom: 'none' }, ({ user, params }) =>
      getParty(user, kind, idFrom(params)),
    ),
    update: route(
      { permission: managePermission, branchFrom: 'none', schema: partySchema },
      async ({ user, body, params, ctx }) => {
        const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
        await updateParty(user, audit, kind, idFrom(params), body)
        return { ok: true }
      },
    ),
    setStatus: route(
      { permission: managePermission, branchFrom: 'none', schema: partyStatusSchema },
      async ({ user, body, params, ctx }) => {
        const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
        await setPartyStatus(user, audit, kind, idFrom(params), body.status)
        return { ok: true }
      },
    ),
  }
}
