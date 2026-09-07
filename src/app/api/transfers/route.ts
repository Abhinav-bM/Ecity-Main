import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { listTransfers, requestTransfer } from '@/server/services/transfer.service'
import { route } from '@/server/http'

const schema = z.object({
  fromBranchId: z.coerce.number().int().positive(),
  toBranchId: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        /** PRD FR-3.7 — the exact handset. Null for accessories. */
        deviceId: z.coerce.number().int().positive().nullable().optional(),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1, 'Add at least one line.'),
  notes: z.string().trim().max(500).optional(),
})

const querySchema = z.object({
  status: z.enum(['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route(
  { permission: 'transfer.view', branchFrom: 'none', schema: querySchema },
  ({ user, body }) => listTransfers(user, body),
)

export const POST = route(
  { permission: 'transfer.request', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.fromBranchId)
    return requestTransfer(user, audit, {
      fromBranchId: body.fromBranchId,
      toBranchId: body.toBranchId,
      lines: body.lines.map((l) => ({
        productId: l.productId,
        deviceId: l.deviceId ?? null,
        quantity: l.quantity,
      })),
      notes: body.notes,
    })
  },
)
