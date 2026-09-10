import { deviceQuerySchema, deviceSchema, rupeesToPaise } from '@/lib/validation'
import { auditContextFromRequest } from '@/server/db/audit'
import { createDevice, listDevices } from '@/server/services/device.service'
import { assertBranchAcceptsTransactions } from '@/server/services/branch.service'
import { route } from '@/server/http'

export const GET = route(
  { permission: 'inventory.view', branchFrom: 'none', schema: deviceQuerySchema },
  ({ user, body }) => listDevices(user, body),
)

/**
 * Registering a device directly. Most devices arrive through a purchase (M3);
 * this exists for opening stock and corrections.
 */
export const POST = route(
  { permission: 'device.manage', branchFrom: 'body', schema: deviceSchema },
  async ({ user, body }) => {
    // A deactivated branch accepts nothing (PRD FR-3.8).
    await assertBranchAcceptsTransactions(user, body.branchId)

    const audit = await auditContextFromRequest(user, user.businessId, body.branchId)
    return createDevice(user, audit, {
      productId: body.productId,
      identifiers: body.identifiers,
      serialNumber: body.serialNumber || undefined,
      mainType: body.mainType,
      isNewCut: body.isNewCut,
      newCutNotes: body.newCutNotes || undefined,
      variant: body.variant || undefined,
      ram: body.ram || undefined,
      storage: body.storage || undefined,
      colour: body.colour || undefined,
      batteryHealthPercent:
        body.batteryHealth === '' || body.batteryHealth === undefined
          ? null
          : body.batteryHealth,
      purchasePricePaise:
        body.purchasePrice === '' || body.purchasePrice === undefined
          ? null
          : rupeesToPaise(body.purchasePrice),
      sellingPricePaise:
        body.sellingPrice === '' || body.sellingPrice === undefined
          ? null
          : rupeesToPaise(body.sellingPrice),
      taxRateId: body.taxRateId,
      supplierId: body.supplierId,
      purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
      warrantyMonths:
        body.warrantyMonths === '' || body.warrantyMonths === undefined
          ? null
          : body.warrantyMonths,
      warrantyProvider: body.warrantyProvider || undefined,
      branchId: body.branchId,
    })
  },
)
