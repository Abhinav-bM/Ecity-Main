import { rupeesToPaise, supplierPaymentSchema } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { recordSupplierPayment } from '@/server/services/supplier-payment.service'
import { route } from '@/server/http'

export const POST = route(
  { permission: 'supplier_payment.manage', branchFrom: 'body', schema: supplierPaymentSchema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return recordSupplierPayment(user, audit, {
      supplierId: body.supplierId,
      branchId: body.branchId,
      paymentMethodId: body.paymentMethodId,
      amountPaise: rupeesToPaise(body.amount),
      paidOn: body.paidOn ? new Date(body.paidOn) : undefined,
      reference: body.reference || undefined,
      notes: body.notes || undefined,
      allocations: body.allocations
        .filter((a) => a.amount > 0)
        .map((a) => ({ purchaseId: a.purchaseId, amountPaise: rupeesToPaise(a.amount) })),
    })
  },
)
