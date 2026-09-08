import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { getDevice, updateDevice } from '@/server/services/device.service'
import { MAIN_TYPES, rupeesToPaise } from '@/lib/validation'
import { AppError, route } from '@/server/http'

const money = z.union([z.coerce.number().min(0), z.literal('')]).optional()
const text = (max: number) => z.union([z.string().trim().max(max), z.literal('')]).optional()

const schema = z.object({
  mainType: z.enum(MAIN_TYPES).optional(),
  isNewCut: z.coerce.boolean().optional(),
  newCutNotes: text(300),
  variant: text(80),
  ram: text(40),
  storage: text(40),
  colour: text(40),
  batteryHealthPercent: z.union([z.coerce.number().int().min(1).max(100), z.literal('')]).optional(),
  purchasePrice: money,
  sellingPrice: money,
  taxRateId: z.union([z.coerce.number().int().positive(), z.literal('')]).nullable().optional(),
  supplierId: z.union([z.coerce.number().int().positive(), z.literal('')]).nullable().optional(),
  warrantyMonths: z.union([z.coerce.number().int().min(0).max(120), z.literal('')]).optional(),
  warrantyProvider: z.string().trim().max(60).optional(),
  salesChannel: z.enum(['ECITY', 'EXTERNAL', 'BOTH']).optional(),
  notes: text(1000),
})

/** Empty string from a form means "clear this", which is null in the database. */
const orNull = <T>(v: T | '' | undefined) => (v === '' ? null : v)

export const GET = route({ permission: 'inventory.view', branchFrom: 'none' }, ({ user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid device id.', 400)
  return getDevice(user, id)
})

export const PATCH = route(
  { permission: 'device.edit', branchFrom: 'none', schema },
  async ({ user, body, params, ctx }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid device id.', 400)
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)

    await updateDevice(user, audit, id, {
      mainType: body.mainType,
      isNewCut: body.isNewCut,
      newCutNotes: orNull(body.newCutNotes),
      variant: orNull(body.variant),
      ram: orNull(body.ram),
      storage: orNull(body.storage),
      colour: orNull(body.colour),
      batteryHealthPercent: orNull(body.batteryHealthPercent),
      // '' clears the price, a number sets it, undefined leaves it alone.
      purchasePricePaise:
        body.purchasePrice === '' ? null
        : body.purchasePrice === undefined ? undefined
        : rupeesToPaise(body.purchasePrice),
      sellingPricePaise:
        body.sellingPrice === '' ? null
        : body.sellingPrice === undefined ? undefined
        : rupeesToPaise(body.sellingPrice),
      taxRateId: orNull(body.taxRateId ?? undefined),
      supplierId: orNull(body.supplierId ?? undefined),
      warrantyMonths: orNull(body.warrantyMonths),
      warrantyProvider: orNull(body.warrantyProvider),
      salesChannel: body.salesChannel,
      notes: orNull(body.notes),
    })
    return { ok: true }
  },
)
