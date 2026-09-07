import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { closeDay, listClosings } from '@/server/services/closing.service'
import { route } from '@/server/http'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.')

const schema = z.object({
  branchId: z.coerce.number().int().positive(),
  businessDate: isoDate,
  countedCash: z.coerce.number().min(0, 'Counted cash cannot be negative.'),
  /** FR-13.2. Counted per non-cash method, keyed by payment method id. */
  countedByMethod: z.record(z.string(), z.coerce.number()).optional(),
  notes: z.string().trim().max(500).optional(),
  externalFeedImported: z.coerce.boolean().optional(),
  overrideReason: z.string().trim().max(300).optional(),
})

const querySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route(
  { permission: 'closing.view', branchFrom: 'none', schema: querySchema },
  ({ user, body }) => listClosings(user, body),
)

export const POST = route(
  { permission: 'closing.create', branchFrom: 'body', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    const countedByMethod = body.countedByMethod
      ? Object.fromEntries(
          Object.entries(body.countedByMethod).map(([k, v]) => [Number(k), rupeesToPaise(v)]),
        )
      : undefined
    return closeDay(user, audit, {
      branchId: body.branchId,
      businessDate: body.businessDate,
      countedCashPaise: rupeesToPaise(body.countedCash),
      countedByMethod,
      notes: body.notes,
      externalFeedImported: body.externalFeedImported,
      overrideReason: body.overrideReason,
    })
  },
)
