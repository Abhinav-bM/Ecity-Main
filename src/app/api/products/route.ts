import { productQuerySchema, productSchema, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createProduct, listProducts } from '@/server/services/product.service'
import { route } from '@/server/http'

export const GET = route(
  { permission: 'product.view', branchFrom: 'none', schema: productQuerySchema },
  ({ user, body }) => listProducts(user, body),
)

export const POST = route(
  { permission: 'product.manage', branchFrom: 'none', schema: productSchema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return createProduct(user, audit, {
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
  },
)
