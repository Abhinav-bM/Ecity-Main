import { z } from 'zod'
import { rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createSale, listSales } from '@/server/services/sale.service'
import { route } from '@/server/http'

const lineSchema = z.object({
  productId: z.coerce.number().int().positive(),
  deviceId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  taxRateId: z.coerce.number().int().positive().nullable().optional(),
})

const saleSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  customerId: z.coerce.number().int().positive().nullable().optional(),
  lines: z.array(lineSchema).min(1, 'Add at least one item.'),
  payments: z
    .array(
      z.object({
        paymentMethodId: z.coerce.number().int().positive(),
        amount: z.coerce.number().min(0),
        reference: z.string().trim().max(80).optional(),
      }),
    )
    .default([]),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().max(64).optional(),
})

const querySchema = z.object({
  search: z.string().trim().max(80).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const GET = route(
  { permission: 'sale.view', branchFrom: 'none', schema: querySchema },
  ({ user, body }) => listSales(user, body),
)

export const POST = route(
  { permission: 'sale.create', branchFrom: 'body', schema: saleSchema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createSale(user, audit, {
      branchId: body.branchId,
      customerId: body.customerId ?? null,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
      lines: body.lines.map((l) => ({
        productId: l.productId,
        deviceId: l.deviceId ?? null,
        quantity: l.quantity,
        unitPricePaise: rupeesToPaise(l.unitPrice),
        discountPaise: rupeesToPaise(l.discount),
        taxRateId: l.taxRateId ?? null,
      })),
      payments: body.payments
        .filter((p) => p.amount > 0)
        .map((p) => ({
          paymentMethodId: p.paymentMethodId,
          amountPaise: rupeesToPaise(p.amount),
          reference: p.reference,
        })),
    })
  },
)
