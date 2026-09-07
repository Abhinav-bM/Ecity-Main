import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { transfer } from '@/server/services/account.service'
import { route } from '@/server/http'

const schema = z.object({
  fromAccountId: z.coerce.number().int().positive(),
  toAccountId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive('A transfer must be more than zero.'),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).optional(),
})

export const POST = route(
  { permission: 'account.manage', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, null)
    await transfer(user, audit, {
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amountPaise: rupeesToPaise(body.amount),
      businessDate: body.businessDate,
      note: body.note,
    })
    return { ok: true }
  },
)
