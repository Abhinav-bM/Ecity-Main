import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { createReturn, listReturns } from '@/server/services/return.service'
import { MAX_QUANTITY, rupeeAmount, rupeesToPaise } from '@/lib/validation'
import { route } from '@/server/http'

const schema = z.object({
  saleId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        saleItemId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().min(1).max(MAX_QUANTITY),
      }),
    )
    .min(1, 'Choose at least one item to return.'),
  reason: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  deduction: rupeeAmount().default(0),
  refundMethod: z.enum(['NONE', 'PAYMENT_METHOD', 'CUSTOMER_ACCOUNT']).default('NONE'),
  paymentMethodId: z.coerce.number().int().positive().optional(),
  reference: z.string().trim().max(120).optional(),
})

const querySchema = z.object({
  search: z.string().trim().max(80).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route({ permission: 'return.view', branchFrom: 'none', schema: querySchema }, ({ user, body }) =>
  listReturns(user, body),
)

export const POST = route(
  { permission: 'return.create', branchFrom: 'body', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createReturn(user, audit, {
      saleId: body.saleId,
      branchId: body.branchId,
      lines: body.lines,
      reason: body.reason,
      notes: body.notes,
      deductionPaise: rupeesToPaise(body.deduction),
      refund:
        body.refundMethod === 'NONE'
          ? undefined
          : {
              method: body.refundMethod,
              paymentMethodId: body.paymentMethodId,
              reference: body.reference,
            },
    })
  },
)
