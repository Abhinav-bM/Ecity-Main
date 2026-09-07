import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { adjust, reconcile, updateAccount } from '@/server/services/account.service'
import { AppError, route } from '@/server/http'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    name: z.string().trim().min(1).max(80).optional(),
    type: z.enum(['BANK', 'UPI', 'CARD', 'WALLET', 'OTHER']).optional(),
    branchId: z.coerce.number().int().positive().nullable().optional(),
    accountNumber: z.string().trim().max(40).optional(),
    bankName: z.string().trim().max(80).optional(),
    ifsc: z.string().trim().max(11).optional(),
    upiId: z.string().trim().max(80).optional(),
    isActive: z.boolean().optional(),
  }),
  /** FR-12.4. Records what the statement said; moves no money by itself. */
  z.object({ action: z.literal('reconcile'), statementBalance: z.coerce.number() }),
  /** A real difference is corrected visibly, in the ledger. */
  z.object({
    action: z.literal('adjust'),
    amount: z.coerce.number(),
    note: z.string().trim().min(1, 'Say what the adjustment is for.').max(300),
  }),
])

export const PATCH = route(
  { permission: 'account.manage', branchFrom: 'none', schema },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid account id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, null)

    if (body.action === 'reconcile') {
      return reconcile(user, audit, id, rupeesToPaise(body.statementBalance))
    }
    if (body.action === 'adjust') {
      await adjust(user, audit, {
        accountId: id,
        amountPaise: rupeesToPaise(body.amount),
        note: body.note,
      })
      return { ok: true }
    }

    await updateAccount(user, audit, id, {
      name: body.name,
      type: body.type,
      branchId: body.branchId,
      accountNumber: body.accountNumber,
      bankName: body.bankName,
      ifsc: body.ifsc,
      upiId: body.upiId,
      isActive: body.isActive,
    })
    return { ok: true }
  },
)
