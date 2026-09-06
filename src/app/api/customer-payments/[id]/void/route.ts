import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { voidCustomerPayment } from '@/server/services/customer-payment.service'
import { AppError, route } from '@/server/http'

const schema = z.object({ reason: z.string().trim().min(3, 'Say why it is being voided.').max(300) })

export const POST = route(
  { permission: 'customer_payment.void', branchFrom: 'none', schema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid receipt id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await voidCustomerPayment(user, audit, id, body.reason)
    return { ok: true }
  },
)
