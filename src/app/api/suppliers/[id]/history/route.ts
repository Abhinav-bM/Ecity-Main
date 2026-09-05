import { supplierHistory } from '@/server/services/supplier-ledger.service'
import { AppError, route } from '@/server/http'

export const GET = route(
  { permission: 'supplier.view', branchFrom: 'none' },
  async ({ user, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid supplier id.', 400)
    const h = await supplierHistory(user, id)
    return {
      balancePaise: String(h.balancePaise),
      purchases: h.purchases.map((p) => ({
        ...p,
        totalPaise: String(p.totalPaise),
        paidPaise: String(p.paidPaise),
      })),
      payments: h.payments.map((p) => ({ ...p, amountPaise: String(p.amountPaise) })),
    }
  },
)
