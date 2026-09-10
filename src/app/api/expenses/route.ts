import { z } from 'zod'
import { rupeeAmount, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createExpense, listExpenses } from '@/server/services/expense.service'
import { route } from '@/server/http'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.')

const schema = z.object({
  branchId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  paymentMethodId: z.coerce.number().int().positive(),
  accountId: z.coerce.number().int().positive().nullable().optional(),
  amount: rupeeAmount({ min: 0.01, minMessage: 'An expense must be more than zero.' }),
  businessDate: isoDate.optional(),
  description: z.string().trim().max(300).optional(),
  reference: z.string().trim().max(80).optional(),
})

const querySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  includeVoided: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route(
  { permission: 'expense.view', branchFrom: 'none', schema: querySchema },
  ({ user, body }) => listExpenses(user, body),
)

export const POST = route(
  { permission: 'expense.manage', branchFrom: 'body', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createExpense(user, audit, {
      branchId: body.branchId,
      categoryId: body.categoryId,
      paymentMethodId: body.paymentMethodId,
      accountId: body.accountId ?? null,
      amountPaise: rupeesToPaise(body.amount),
      businessDate: body.businessDate,
      description: body.description,
      reference: body.reference,
    })
  },
)
