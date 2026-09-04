import { productSchema, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { getProduct, updateProduct } from '@/server/services/product.service'
import { AppError, route } from '@/server/http'

function idFrom(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id.', 400)
  return id
}

export const GET = route({ permission: 'product.view', branchFrom: 'none' }, ({ user, params }) =>
  getProduct(user, idFrom(params)),
)

export const PATCH = route(
  { permission: 'product.manage', branchFrom: 'none', schema: productSchema },
  async ({ user, body, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await updateProduct(user, audit, idFrom(params), {
      ...body,
      defaultPurchasePricePaise:
        body.purchasePrice === '' || body.purchasePrice === undefined
          ? null
          : rupeesToPaise(body.purchasePrice),
      defaultSellingPricePaise:
        body.sellingPrice === '' || body.sellingPrice === undefined
          ? null
          : rupeesToPaise(body.sellingPrice),
    })
    return { ok: true }
  },
)
