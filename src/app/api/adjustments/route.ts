import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { createAdjustment, listAdjustments } from '@/server/services/adjustment.service'
import { route } from '@/server/http'

const REASONS = ['DAMAGE', 'LOSS', 'MISCOUNT', 'DATA_ENTRY_ERROR'] as const

const schema = z.object({
  branchId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
  /** PRD FR-28.2 — an adjustment is about one handset, or about a count. */
  deviceId: z.coerce.number().int().positive().nullable().optional(),
  reason: z.enum(REASONS),
  quantityDelta: z.coerce.number().int().optional(),
  notes: z.string().trim().max(500).optional(),
})

const querySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  reason: z.enum(REASONS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route(
  { permission: 'adjustment.view', branchFrom: 'none', schema: querySchema },
  ({ user, body }) => listAdjustments(user, body),
)

export const POST = route(
  { permission: 'adjustment.create', branchFrom: 'body', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createAdjustment(user, audit, {
      branchId: body.branchId,
      productId: body.productId,
      deviceId: body.deviceId ?? null,
      reason: body.reason,
      quantityDelta: body.quantityDelta,
      notes: body.notes,
    })
  },
)
