import { supplierOutstanding } from '@/server/services/supplier-ledger.service'
import { route } from '@/server/http'

export const GET = route(
  { permission: 'supplier_payment.view', branchFrom: 'none' },
  async ({ user }) =>
    // bigint does not survive JSON, so amounts go over the wire as strings.
    (await supplierOutstanding(user, 1, 500)).rows.map((r) => ({
      ...r,
      balancePaise: String(r.balancePaise),
    })),
)
