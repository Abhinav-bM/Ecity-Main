import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createAccount } from '@/server/services/account.service'
import { listAccounts } from '@/server/services/cash.service'
import { route } from '@/server/http'

const schema = z.object({
  name: z.string().trim().min(1, 'An account needs a name.').max(80),
  type: z.enum(['BANK', 'UPI', 'CARD', 'WALLET', 'OTHER']),
  /** Null means shared by every branch (PRD FR-12.2). */
  branchId: z.coerce.number().int().positive().nullable().optional(),
  accountNumber: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(80).optional(),
  ifsc: z.string().trim().max(11).optional(),
  upiId: z.string().trim().max(80).optional(),
  openingBalance: z.coerce.number().default(0),
})

export const GET = route({ permission: 'account.view', branchFrom: 'none' }, ({ user }) =>
  listAccounts(user, { includeInactive: true }),
)

export const POST = route(
  { permission: 'account.manage', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId ?? null)
    return createAccount(user, audit, {
      name: body.name,
      type: body.type,
      branchId: body.branchId ?? null,
      accountNumber: body.accountNumber,
      bankName: body.bankName,
      ifsc: body.ifsc,
      upiId: body.upiId,
      openingBalancePaise: rupeesToPaise(body.openingBalance),
    })
  },
)
