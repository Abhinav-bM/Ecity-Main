import { voidPaymentSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { voidSupplierPayment } from '@/server/services/supplier-payment.service'
import { AppError, route } from '@/server/http'

export const POST = route(
  { permission: 'supplier_payment.manage', branchFrom: 'none', schema: voidPaymentSchema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid payment id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await voidSupplierPayment(user, audit, id, body.reason)
    return { ok: true }
  },
)
