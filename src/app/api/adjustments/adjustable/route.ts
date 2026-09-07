import { z } from 'zod'
import { adjustableStock } from '@/server/services/adjustment.service'
import { route } from '@/server/http'

const schema = z.object({
  branchId: z.coerce.number().int().positive(),
  search: z.string().trim().max(80).optional(),
})

/** Accessories a branch holds, for the adjustment picker. */
export const GET = route(
  { permission: 'adjustment.view', branchFrom: 'none', schema },
  ({ user, body }) => adjustableStock(user, body.branchId, body.search),
)
