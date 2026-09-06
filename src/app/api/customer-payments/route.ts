import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { recordCustomerPayment } from '@/server/services/customer-payment.service'
import { route } from '@/server/http'

const schema = z.object({
  customerId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive(),
  paymentMethodId: z.coerce.number().int().positive(),
  amountPaise: z.coerce.bigint().positive('Enter an amount.'),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  receivedOn: z.coerce.date().optional(),
  /** Omitted means oldest invoice first. */
  allocations: z
    .array(
      z.object({
        saleId: z.coerce.number().int().positive(),
        amountPaise: z.coerce.bigint().nonnegative(),
      }),
    )
    .optional(),
})

export const POST = route(
  { permission: 'customer_payment.manage', branchFrom: 'body', schema },
  async ({ user, body, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    return recordCustomerPayment(user, audit, body)
  },
)
