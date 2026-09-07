import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { acceptTradeIn, listTradeIns } from '@/server/services/trade-in.service'
import { MAIN_TYPES, rupeesToPaise } from '@/lib/validation'
import { route } from '@/server/http'

const schema = z.object({
  productId: z.coerce.number().int().positive(),
  identifiers: z.array(z.string().trim().min(1)).min(1, 'Enter the IMEI or serial number.'),
  branchId: z.coerce.number().int().positive(),
  mainType: z.enum(MAIN_TYPES),
  isNewCut: z.coerce.boolean().default(false),
  newCutNotes: z.string().trim().max(300).optional(),
  variant: z.string().trim().max(80).optional(),
  storage: z.string().trim().max(40).optional(),
  colour: z.string().trim().max(40).optional(),
  batteryHealthPercent: z.coerce.number().int().min(1).max(100).optional(),
  conditionNotes: z.string().trim().max(500).optional(),
  estimatedValue: z.coerce.number().min(0).optional(),
  agreedValue: z.coerce.number().min(0),
  customerId: z.coerce.number().int().positive().nullable().optional(),
  saleId: z.coerce.number().int().positive().nullable().optional(),
})

export const GET = route({ permission: 'sale.view', branchFrom: 'none' }, ({ user }) =>
  listTradeIns(user),
)

export const POST = route(
  { permission: 'sale.create', branchFrom: 'body', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return acceptTradeIn(user, audit, {
      ...body,
      estimatedValuePaise:
        body.estimatedValue === undefined ? undefined : rupeesToPaise(body.estimatedValue),
      agreedValuePaise: rupeesToPaise(body.agreedValue),
    })
  },
)
