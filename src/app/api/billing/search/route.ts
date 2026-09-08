import { z } from 'zod'
import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { branchStock, deviceIdentifier, deviceUnit, product } from '@/server/db/schema'
import { branchScope } from '@/server/auth/permissions'
import { route } from '@/server/http'

const schema = z.object({
  q: z.string().trim().min(1).max(120),
  branchId: z.coerce.number().int().positive(),
})

/**
 * The one search the billing screen uses (PRD FR-6.1).
 *
 * A full identifier match short-circuits everything else: at the counter,
 * scanning an IMEI should land on that exact handset immediately rather than
 * offering a list.
 *
 * Devices billed in the other system are excluded here as well as refused at
 * save time (FR-38.2) - the till should never show what it cannot sell.
 */
export const GET = route(
  { permission: 'inventory.view', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const scope = branchScope(user, body.branchId)
    if (scope !== null && !scope.includes(body.branchId)) return { devices: [], products: [] }

    const term = body.q.trim()
    const bare = term.replace(/[\s-]/g, '')

    const devices = await db
      .select({
        deviceId: deviceUnit.id,
        identifier: deviceUnit.primaryIdentifier,
        productId: deviceUnit.productId,
        productName: product.name,
        mainType: deviceUnit.mainType,
        isNewCut: deviceUnit.isNewCut,
        salesChannel: deviceUnit.salesChannel,
        /*
         * The handset's own price if it has one, otherwise the product's list
         * price.
         *
         * Found in use: a purchase books a handset in with its *cost* and no
         * selling price, so the till had nothing to prefill and the counter
         * typed the price on every handset — while accessories prefilled
         * fine, because the product branch of this same query has always used
         * the default. The fallback fixes every handset already in the
         * database, with nothing to re-enter.
         *
         * The unit still wins where it has its own price: used stock is
         * priced piece by piece, and the product default is a starting point,
         * not an override.
         */
        sellingPricePaise: sql<string | null>`coalesce(
          ${deviceUnit.sellingPricePaise}, ${product.defaultSellingPricePaise}
        )`,
        taxRateId: deviceUnit.taxRateId,
        colour: deviceUnit.colour,
        storage: deviceUnit.storage,
        batteryHealthPercent: deviceUnit.batteryHealthPercent,
      })
      .from(deviceUnit)
      .innerJoin(product, eq(product.id, deviceUnit.productId))
      .where(
        and(
          eq(deviceUnit.businessId, user.businessId),
          eq(deviceUnit.currentBranchId, body.branchId),
          eq(deviceUnit.status, 'IN_STOCK'),
          // Never offer what the till is not allowed to sell.
          sql`${deviceUnit.salesChannel} <> 'EXTERNAL'`,
          or(
            ilike(deviceUnit.primaryIdentifier, `%${bare}%`),
            sql`exists (select 1 from ${deviceIdentifier}
                        where ${deviceIdentifier.deviceId} = ${deviceUnit.id}
                          and ${deviceIdentifier.value} ilike ${`%${bare}%`})`,
            ilike(product.name, `%${term}%`),
          )!,
        ),
      )
      .limit(15)

    const products = await db
      .select({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        sellingPricePaise: product.defaultSellingPricePaise,
        taxRateId: product.taxRateId,
        quantity: sql<number>`coalesce(${branchStock.quantity}, 0)`,
      })
      .from(product)
      .leftJoin(
        branchStock,
        and(eq(branchStock.productId, product.id), eq(branchStock.branchId, body.branchId)),
      )
      .where(
        and(
          eq(product.businessId, user.businessId),
          eq(product.isActive, true),
          // Serialised products are sold by choosing a unit, not the product.
          eq(product.isSerialised, false),
          or(
            ilike(product.name, `%${term}%`),
            ilike(product.sku, `%${term}%`),
            ilike(product.barcode, `%${term}%`),
          )!,
        ),
      )
      .limit(15)

    return {
      devices: devices.map((d) => ({
        ...d,
        sellingPricePaise: d.sellingPricePaise ? String(d.sellingPricePaise) : null,
      })),
      products: products.map((p) => ({
        ...p,
        sellingPricePaise: p.sellingPricePaise ? String(p.sellingPricePaise) : null,
      })),
    }
  },
)
