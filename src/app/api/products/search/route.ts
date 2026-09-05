import { z } from 'zod'
import { listProducts } from '@/server/services/product.service'
import { route } from '@/server/http'

const schema = z.object({
  q: z.string().trim().max(120).optional(),
  serialised: z.coerce.boolean().optional(),
})

/**
 * Type-ahead product lookup for the pickers.
 *
 * The forms used to load the whole catalogue into a <select> capped at 500,
 * which silently made products beyond that unselectable. Searching on the
 * server scales to any catalogue and is what M4's billing screen needs too.
 */
export const GET = route({ permission: 'product.view', branchFrom: 'none', schema }, async ({ user, body }) => {
  const { rows } = await listProducts(user, {
    search: body.q,
    serialised: body.serialised,
    page: 1,
    pageSize: 25,
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    isSerialised: r.isSerialised,
    identifierType: r.identifierType,
    quantity: r.quantity,
    purchasePricePaise: r.purchasePricePaise ? String(r.purchasePricePaise) : null,
  }))
})
