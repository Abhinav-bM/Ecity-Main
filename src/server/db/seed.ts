import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { hashPassword } from '@/server/auth/password'
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions'
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
  rolePermission,
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
  const existingBusiness = await db.select().from(business).limit(1)
  const biz =
    existingBusiness[0] ??
    (
      await db
        .insert(business)
        .values({ name: 'ECITY Mobiles', currency: 'INR', timezone: 'Asia/Kolkata' })
        .returning()
    )[0]!
  console.log(`  business: ${biz.name} (#${biz.id})`)

  // 3. System roles
  const roleIds: Record<string, number> = {}
  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const existing = await db
      .select()
      .from(role)
      .where(sql`${role.businessId} = ${biz.id} and ${role.code} = ${code}`)
      .limit(1)
    const r =
      existing[0] ??
      (
        await db
          .insert(role)
          .values({
            businessId: biz.id,
            code,
            name: def.name,
            description: def.description,
            isSystem: true,
          })
          .returning()
      )[0]!
    roleIds[code] = r.id

    await db.delete(rolePermission).where(eq(rolePermission.roleId, r.id))
    if (def.permissions.length > 0) {
      await db
        .insert(rolePermission)
        .values(def.permissions.map((p) => ({ roleId: r.id, permissionCode: p })))
    }
    console.log(`  role: ${code} (${def.permissions.length} permissions)`)
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
      (await db.insert(branch).values({ businessId: biz.id, code, name }).returning())[0]!
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
  const productCategories = [
    { name: 'Mobiles', isSerialised: true, sortOrder: 1 },
    { name: 'Chargers', isSerialised: false, sortOrder: 2 },
    { name: 'Cases', isSerialised: false, sortOrder: 3 },
    { name: 'Screen guards', isSerialised: false, sortOrder: 4 },
    { name: 'Earphones', isSerialised: false, sortOrder: 5 },
    { name: 'Cables', isSerialised: false, sortOrder: 6 },
    { name: 'Power banks', isSerialised: false, sortOrder: 7 },
    { name: 'Watches', isSerialised: false, sortOrder: 8 },
    { name: 'Other accessories', isSerialised: false, sortOrder: 9 },
  ]
  for (const c of productCategories) {
    await db
      .insert(category)
      .values({ businessId: biz.id, ...c })
      .onConflictDoUpdate({
        target: [category.businessId, category.name],
        set: { isSerialised: c.isSerialised, sortOrder: c.sortOrder },
      })
  }
  console.log(`  product categories: ${productCategories.length}`)

  const brands = ['Apple', 'Samsung', 'Xiaomi', 'Realme', 'OnePlus', 'Vivo', 'Oppo', 'Nothing']
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
