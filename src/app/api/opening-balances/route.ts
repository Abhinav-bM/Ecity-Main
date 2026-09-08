import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  openingCash,
  openingDues,
  openingStock,
} from '@/server/services/opening-balance.service'
import { route } from '@/server/http'

/**
 * PRD FR-34.1 – FR-34.3. What the shop already had on the day it starts.
 *
 * One endpoint with three shapes rather than three endpoints: they are the
 * same act — declaring a starting figure — and the screen that posts them is
 * one screen with three tabs.
 */
const asOf = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the day these figures are as at.')

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cash'),
    asOf,
    branches: z
      .array(z.object({ branchId: z.coerce.number().int().positive(), amount: z.coerce.number() }))
      .default([]),
    accounts: z
      .array(z.object({ accountId: z.coerce.number().int().positive(), amount: z.coerce.number() }))
      .default([]),
  }),
  z.object({
    kind: z.literal('stock'),
    asOf,
    branchId: z.coerce.number().int().positive(),
    lines: z
      .array(
        z.object({
          productId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1, 'Add at least one product.'),
  }),
  z.object({
    kind: z.literal('dues'),
    asOf,
    customers: z
      .array(
        z.object({ customerId: z.coerce.number().int().positive(), amount: z.coerce.number() }),
      )
      .default([]),
    suppliers: z
      .array(
        z.object({ supplierId: z.coerce.number().int().positive(), amount: z.coerce.number() }),
      )
      .default([]),
  }),
])

export const POST = route(
  { permission: 'product.manage', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, null)

    if (body.kind === 'cash') {
      return openingCash(user, audit, {
        asOf: body.asOf,
        branches: body.branches.map((b) => ({
          branchId: b.branchId,
          amountPaise: rupeesToPaise(b.amount),
        })),
        accounts: body.accounts.map((a) => ({
          accountId: a.accountId,
          amountPaise: rupeesToPaise(a.amount),
        })),
      })
    }

    if (body.kind === 'stock') {
      return openingStock(user, audit, {
        branchId: body.branchId,
        asOf: body.asOf,
        lines: body.lines,
      })
    }

    return openingDues(user, audit, {
      asOf: body.asOf,
      customers: body.customers.map((c) => ({
        customerId: c.customerId,
        amountPaise: rupeesToPaise(c.amount),
      })),
      suppliers: body.suppliers.map((s) => ({
        supplierId: s.supplierId,
        amountPaise: rupeesToPaise(s.amount),
      })),
    })
  },
)
