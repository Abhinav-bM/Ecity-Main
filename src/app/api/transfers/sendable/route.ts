import { z } from 'zod'
import { sendableStock } from '@/server/services/transfer.service'
import { route } from '@/server/http'

const schema = z.object({
  branchId: z.coerce.number().int().positive(),
  search: z.string().trim().max(80).optional(),
})

/** What a branch can actually send: devices in stock and accessories on hand. */
export const GET = route(
  { permission: 'transfer.view', branchFrom: 'none', schema },
  ({ user, body }) => sendableStock(user, body.branchId, body.search),
)
