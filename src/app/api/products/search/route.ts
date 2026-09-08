import { z } from 'zod'
import { queryBoolean } from '@/lib/validation'
import { listProducts } from '@/server/services/product.service'
import { route } from '@/server/http'

const schema = z.object({
  q: z.string().trim().max(120).optional(),
  // Not z.coerce.boolean(): "false" is a non-empty string and would arrive
  // as true, so ?serialised=false would mean "serialised only".
  serialised: queryBoolean.optional(),
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
    // So a purchase line can prefill what the shop sells it for, not only
    // what it pays.
    sellingPricePaise: r.sellingPricePaise ? String(r.sellingPricePaise) : null,
  }))
})
