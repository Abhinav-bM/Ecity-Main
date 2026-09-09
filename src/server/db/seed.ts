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
 *
 * **Two modes**, because a real shop and a test suite need different things.
 *
 * The default is the *minimum a person needs to sign in and start*: the
 * permission catalogue, the three system roles, the business, and an admin.
 * Nothing else. A shop's branches, its tax rates, its payment methods and its
 * catalogue belong to the shop — seeding "Main Branch" and "GST 12%" hands a
 * new owner someone else's guesses to delete before they can enter their own,
 * and a demo branch that survives into production is worse than none.
 *
 * `--demo` (or SEED_DEMO=true) adds that sample data back. The browser suite
 * depends on it: 850 tests bill against MAIN, pick "Mobiles (IMEI)" and take
 * cash, and none of that exists in an empty shop. So CI and
 * scripts/test-clean-db.sh seed with demo data; a server does not.
 */
const DEMO = process.argv.includes('--demo') || process.env.SEED_DEMO === 'true'

async function main() {
  console.log(DEMO ? 'Seeding (with demo data)...' : 'Seeding (minimum to sign in)...')

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

  /*
   * 4. Branches — demo only.
   *
   * A shop names its own branches and their codes appear on every document
   * number, so a seeded "MAIN" is a guess somebody has to undo. Created from
   * Settings → Branches on a real install.
   */
  const branchIds: Record<string, number> = {}
  for (const [code, name] of (DEMO
    ? ([
      ['MAIN', 'Main Branch'],
      ['NORTH', 'North Branch'],
    ] as const)
    : ([] as const)) as readonly (readonly [string, string])[]) {
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

  /*
   * 5 and 6. Tax rates, payment methods, expense heads and the catalogue —
   * demo only.
   *
   * All four are the shop's own, and all four can be created in the app:
   * tax rates, payment methods and expense heads in Settings → Business,
   * brands and categories in Settings → Catalogue. Seeding "GST 18%" into a
   * shop that is below the registration threshold is a guess it then has to
   * undo.
   *
   * The browser suite needs them, so they stay behind --demo.
   */
  if (DEMO) {
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

  }

  /*
   * 7. Users. The admin always — without one nobody can sign in at all. The
   * manager and staff accounts are demo: they exist so the authorisation
   * matrix can be tested, and a real shop creates its own people with their
   * own names. They are also branch-scoped, and in the minimum seed there are
   * no branches to scope them to.
   */
  const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2026'
  const users = [
    { email: 'admin@ecity.local', name: 'Owner', roleCode: 'ADMIN', branches: [] as string[] },
    ...(DEMO
      ? [
          {
            email: 'manager@ecity.local',
            name: 'Main Branch Manager',
            roleCode: 'MANAGER',
            branches: ['MAIN'],
          },
          {
            email: 'staff@ecity.local',
            name: 'Counter Staff',
            roleCode: 'STAFF',
            branches: ['MAIN'],
          },
        ]
      : []),
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
  console.log('Change that password immediately - the account is flagged mustChangePassword.')
  if (DEMO) {
    console.log('\nDemo data is in: two branches, GST rates, payment methods and a')
    console.log('catalogue, plus manager and staff logins. Do NOT use --demo on a')
    console.log('server a shop will actually trade on.')
  } else {
    console.log('\nNothing else was created. Sign in and set the shop up:')
    console.log('  Settings -> Business   name, GST toggle, tax rates, payment methods')
    console.log('  Settings -> Branches   at least one, before anything can be billed')
    console.log('  Settings -> Catalogue  brands and product categories')
    console.log('  Settings -> Users      the people who will use it')
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
