import { setActiveSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { setProductActive } from '@/server/services/product.service'
import { AppError, route } from '@/server/http'

/**
 * Retire a product, or bring one back (PRD FR-4.x, docs/02 §2.2 rule 4).
 *
 * Deactivating is the only kind of removal the catalogue has, and deliberately
 * so: a product that has ever been bought or sold is referred to by that
 * purchase, that bill and every stock movement in between, and deleting it
 * would leave them pointing at nothing. An inactive product keeps all of that
 * and simply stops being offered — it drops out of the pickers and the till,
 * and out of the products list unless "Show inactive" is on.
 *
 * The service behind this has existed since M2 with nothing calling it, so
 * until now the catalogue could only be added to.
 */
export const PATCH = route(
  { permission: 'product.manage', branchFrom: 'none', schema: setActiveSchema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await setProductActive(user, audit, id, body.isActive)
    return { ok: true }
  },
)
