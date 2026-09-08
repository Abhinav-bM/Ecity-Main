import { purchaseQuerySchema, purchaseSchema, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createPurchase, listPurchases } from '@/server/services/purchase.service'
import { route } from '@/server/http'

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
      purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : undefined,
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
        warrantyProvider: l.warrantyProvider || undefined,
        sellingPricePaise:
          l.sellingPrice === '' || l.sellingPrice === undefined
            ? undefined
            : rupeesToPaise(l.sellingPrice),
      })),
    })
  },
)
