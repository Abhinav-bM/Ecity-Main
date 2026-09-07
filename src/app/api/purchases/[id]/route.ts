import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { getPurchase, updatePurchaseMeta } from '@/server/services/purchase.service'
import { AppError, route } from '@/server/http'

export const GET = route({ permission: 'purchase.view', branchFrom: 'none' }, ({ user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid purchase id.', 400)
  return getPurchase(user, id)
})

/**
 * PRD carried-in from M5. Metadata only — lines, quantities and costs are not
 * editable on a confirmed purchase; reversal is the honest tool for those.
 */
const schema = z.object({
  supplierInvoiceNumber: z.string().trim().max(60).nullable().optional(),
  purchaseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export const PATCH = route(
  { permission: 'purchase.edit', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid purchase id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await updatePurchaseMeta(user, audit, id, body)
    return { ok: true }
  },
)
