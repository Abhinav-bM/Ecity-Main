import 'dotenv/config'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { hashPassword } from '@/server/auth/password'
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions'
import { syncSystemRoles } from './sync-roles'
import {
  appUser,
  brand,
  branch,
  business,
  category,
  expenseCategory,
  paymentMethod,
  permission,
  role,
  taxRate,
  userBranch,
} from './schema'

/**
 * Idempotent seed. Safe to run repeatedly - it upserts.
 * Creates: the business, two branches, the three system roles, and one admin.
 */
async function main() {
  console.log('Seeding...')

  // 1. Permission catalogue - the code in src/lib/permissions.ts is the truth.
  for (const code of ALL_PERMISSIONS) {
    const meta = PERMISSIONS[code]
    await db
      .insert(permission)
      .values({
        code,
        group: meta.group,
        label: meta.label,
        description: 'description' in meta ? meta.description : null,
      })
      .onConflictDoUpdate({
        target: permission.code,
        set: { group: meta.group, label: meta.label },
      })
  }
  console.log(`  permissions: ${ALL_PERMISSIONS.length}`)

  // Remove permissions that no longer exist in code.
  await db.delete(permission).where(
    sql`${permission.code} NOT IN ${sql.raw(
      `(${ALL_PERMISSIONS.map((c) => `'${c}'`).join(',')})`,
    )}`,
  )

  // 2. Business
  // Deterministic: always the first business ever created. Without an
  // ORDER BY, a leftover test business could be picked instead and the whole
  // seed would land in the wrong tenant.
  const existingBusiness = await db.select().from(business).orderBy(asc(business.id)).limit(1)
  const biz =
    existingBusiness[0] ??
    (
      await db
        .insert(business)
        .values({
          name: 'ECITY Mobiles',
          currency: 'INR',
          timezone: 'Asia/Kolkata',
          // A registered shop, so invoices carry a real place of supply.
          gstin: '32AAAAA0000A1Z5',
          stateCode: '32',
        })
        .returning()
    )[0]!
  console.log(`  business: ${biz.name} (#${biz.id})`)

  // 3. System roles — the same sync the deploy runs, so seeding and
  //    deploying can never disagree about who may do what.
  await syncSystemRoles()
  const roleIds: Record<string, number> = {}
  for (const code of Object.keys(SYSTEM_ROLES)) {
    const r = (
      await db
        .select({ id: role.id })
        .from(role)
        .where(sql`${role.businessId} = ${biz.id} and ${role.code} = ${code}`)
        .limit(1)
    )[0]!
    roleIds[code] = r.id
  }

  // 4. Two branches so branch scoping can actually be demonstrated.
  const branchIds: Record<string, number> = {}
  for (const [code, name] of [
    ['MAIN', 'Main Branch'],
    ['NORTH', 'North Branch'],
  ] as const) {
    const existing = await db
      .select()
      .from(branch)
      .where(sql`${branch.businessId} = ${biz.id} and ${branch.code} = ${code}`)
      .limit(1)
    const b =
      existing[0] ??
      (
        await db
          .insert(branch)
          .values({ businessId: biz.id, code, name, stateCode: '32' })
          .returning()
      )[0]!
    branchIds[code] = b.id
    console.log(`  branch: ${code} (#${b.id})`)
  }

  // 5. M1 master data defaults - GST slabs, payment methods, expense heads.
  //    Real Indian retail values, so the pickers in M3/M4 are usable at once.
  const rates = [
    { name: 'GST 0%', rateBasisPoints: 0, isDefault: false },
    { name: 'GST 5%', rateBasisPoints: 500, isDefault: false },
    { name: 'GST 12%', rateBasisPoints: 1200, isDefault: false },
    { name: 'GST 18%', rateBasisPoints: 1800, isDefault: true },
    { name: 'GST 28%', rateBasisPoints: 2800, isDefault: false },
  ]
  for (const r of rates) {
    await db
      .insert(taxRate)
      .values({ businessId: biz.id, ...r })
      .onConflictDoUpdate({
        target: [taxRate.businessId, taxRate.name],
        set: { rateBasisPoints: r.rateBasisPoints },
      })
  }
  console.log(`  tax rates: ${rates.length}`)

  const methods = [
    { code: 'CASH', name: 'Cash', type: 'CASH' as const, affectsCashDrawer: true, sortOrder: 1 },
    { code: 'UPI', name: 'UPI', type: 'UPI' as const, affectsCashDrawer: false, sortOrder: 2 },
    { code: 'CARD', name: 'Card', type: 'CARD' as const, affectsCashDrawer: false, sortOrder: 3 },
    {
      code: 'BANK',
      name: 'Bank Transfer',
      type: 'BANK_TRANSFER' as const,
      affectsCashDrawer: false,
      sortOrder: 4,
    },
  ]
  for (const m of methods) {
    await db
      .insert(paymentMethod)
      .values({ businessId: biz.id, ...m })
      .onConflictDoUpdate({
        target: [paymentMethod.businessId, paymentMethod.code],
        set: { name: m.name, type: m.type, affectsCashDrawer: m.affectsCashDrawer },
      })
  }
  console.log(`  payment methods: ${methods.length}`)

  const categories = [
    'Rent',
    'Electricity',
    'Salaries',
    'Transport',
    'Packaging',
    'Repairs',
    'Miscellaneous',
  ]
  for (const name of categories) {
    await db
      .insert(expenseCategory)
      .values({ businessId: biz.id, name })
      .onConflictDoNothing({ target: [expenseCategory.businessId, expenseCategory.name] })
  }
  console.log(`  expense categories: ${categories.length}`)

  // 6. M2 catalogue - the categories in PRD FR-4.1, plus common brands.
  //    Mobiles are serialised (tracked by IMEI); accessories are counted.
  // Serialised categories are tracked one unit at a time. Phones carry an
  // IMEI; laptops and other electronics carry a manufacturer serial. The
  // classification (NEW/USED/ER/ACT/GLOBAL) is the same for all of them.
  const IMEI = 'IMEI' as const
  const SERIAL = 'SERIAL' as const
  const NONE = 'NONE' as const
  const productCategories = [
    { name: 'Mobiles', isSerialised: true, identifierType: IMEI, sortOrder: 1 },
    { name: 'Tablets', isSerialised: true, identifierType: IMEI, sortOrder: 2 },
    { name: 'Laptops', isSerialised: true, identifierType: SERIAL, sortOrder: 3 },
    { name: 'MacBooks', isSerialised: true, identifierType: SERIAL, sortOrder: 4 },
    { name: 'Smart watches', isSerialised: true, identifierType: SERIAL, sortOrder: 5 },
    { name: 'Speakers', isSerialised: true, identifierType: SERIAL, sortOrder: 6 },
    { name: 'Chargers', isSerialised: false, identifierType: NONE, sortOrder: 20 },
    { name: 'Cases', isSerialised: false, identifierType: NONE, sortOrder: 21 },
    { name: 'Screen guards', isSerialised: false, identifierType: NONE, sortOrder: 22 },
    { name: 'Earphones', isSerialised: false, identifierType: NONE, sortOrder: 23 },
    { name: 'Cables', isSerialised: false, identifierType: NONE, sortOrder: 24 },
    { name: 'Power banks', isSerialised: false, identifierType: NONE, sortOrder: 25 },
    { name: 'Other accessories', isSerialised: false, identifierType: NONE, sortOrder: 26 },
  ]
  for (const c of productCategories) {
    await db
      .insert(category)
      .values({ businessId: biz.id, ...c })
      .onConflictDoUpdate({
        target: [category.businessId, category.name],
        set: {
          isSerialised: c.isSerialised,
          identifierType: c.identifierType,
          sortOrder: c.sortOrder,
        },
      })
  }
  console.log(`  product categories: ${productCategories.length}`)

  const brands = [
    'Apple',
    'Samsung',
    'Xiaomi',
    'Realme',
    'OnePlus',
    'Vivo',
    'Oppo',
    'Nothing',
    'Dell',
    'HP',
    'Lenovo',
    'Asus',
    'Bose',
    'JBL',
    'boAt',
  ]
  for (const name of brands) {
    await db
      .insert(brand)
      .values({ businessId: biz.id, name })
      .onConflictDoNothing({ target: [brand.businessId, brand.name] })
  }
  console.log(`  brands: ${brands.length}`)

  // 7. Users - one per role, so the authorisation matrix can be tested.
  const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'
  const users = [
    { email: 'admin@ecity.local', name: 'Owner', roleCode: 'ADMIN', branches: [] as string[] },
    {
      email: 'manager@ecity.local',
      name: 'Main Branch Manager',
      roleCode: 'MANAGER',
      branches: ['MAIN'],
    },
    { email: 'staff@ecity.local', name: 'Counter Staff', roleCode: 'STAFF', branches: ['MAIN'] },
  ]

  for (const u of users) {
    const existing = await db
      .select()
      .from(appUser)
      .where(sql`${appUser.businessId} = ${biz.id} and ${appUser.email} = ${u.email}`)
      .limit(1)
    const created =
      existing[0] ??
      (
        await db
          .insert(appUser)
          .values({
            businessId: biz.id,
            name: u.name,
            email: u.email,
            passwordHash: await hashPassword(password),
            roleId: roleIds[u.roleCode]!,
            mustChangePassword: true,
          })
          .returning()
      )[0]!

    await db.delete(userBranch).where(eq(userBranch.userId, created.id))
    if (u.branches.length > 0) {
      await db
        .insert(userBranch)
        .values(u.branches.map((c) => ({ userId: created.id, branchId: branchIds[c]! })))
    }
    console.log(`  user: ${u.email} (${u.roleCode})`)
  }

  console.log(`\nDone. Sign in with admin@ecity.local / ${password}`)
  console.log('Change that password immediately - every seeded user is flagged')
  console.log('mustChangePassword, and these accounts must not exist in production.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
