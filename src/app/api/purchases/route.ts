import { purchaseQuerySchema, purchaseSchema, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createPurchase, listPurchases } from '@/server/services/purchase.service'
import { AppError, route } from '@/server/http'
import { parseShopDate } from '@/lib/date'

/** A yyyy-mm-dd from the form, or nothing. Anything else is said, not ignored. */
function day(value: string | undefined, what: string): Date | undefined {
  if (!value) return undefined
  const parsed = parseShopDate(value)
  if (!parsed) throw new AppError(`That ${what} is not a real date.`, 422, 'BAD_DATE')
  return parsed
}

export const GET = route(
  { permission: 'purchase.view', branchFrom: 'none', schema: purchaseQuerySchema },
  ({ user, body }) => listPurchases(user, body),
)

export const POST = route(
  { permission: 'purchase.manage', branchFrom: 'body', schema: purchaseSchema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createPurchase(user, audit, {
      supplierId: body.supplierId,
      branchId: body.branchId,
      /*
       * `parseShopDate`, not `new Date`: these arrive as free text, and an
       * Invalid Date survives every check until the driver refuses it, which
       * fails the whole purchase with a message about nothing.
       */
      purchaseDate: day(body.purchaseDate, 'bill date'),
      arrivedAt: day(body.arrivedAt, 'arrival date'),
      supplierInvoiceNumber: body.supplierInvoiceNumber || undefined,
      notes: body.notes || undefined,
      lines: body.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCostPaise: rupeesToPaise(l.unitCost),
        discountPaise: rupeesToPaise(l.discount),
        taxRateId: l.taxRateId,
        identifiers: l.identifiers,
        units: l.units.map((u) => ({
          identifier: u.identifier,
          serialNumber: u.serialNumber || undefined,
          variant: u.variant || undefined,
          ram: u.ram || undefined,
          storage: u.storage || undefined,
          colour: u.colour || undefined,
          batteryHealthPercent: u.batteryHealthPercent,
        })),
        mainType: l.mainType,
        isNewCut: l.isNewCut,
        newCutNotes: l.newCutNotes || undefined,
        variant: l.variant || undefined,
        ram: l.ram || undefined,
        storage: l.storage || undefined,
        colour: l.colour || undefined,
        warrantyMonths:
          l.warrantyMonths === '' || l.warrantyMonths === undefined
            ? undefined
            : l.warrantyMonths,
        warrantyUntil: day(l.warrantyUntil, 'warranty end date') ?? null,
        warrantyProvider: l.warrantyProvider || undefined,
        sellingPricePaise:
          l.sellingPrice === '' || l.sellingPrice === undefined
            ? undefined
            : rupeesToPaise(l.sellingPrice),
      })),
    })
  },
)
