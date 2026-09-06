import { eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { business, role, rolePermission } from '@/server/db/schema'
import { SYSTEM_ROLES } from '@/lib/permissions'

/**
 * Bring every business's system roles in line with the code.
 *
 * A module that adds a permission only adds it to SYSTEM_ROLES; the roles
 * already in the database keep whatever they were seeded with. M5 hit exactly
 * this - `customer_payment.view` existed in code and nobody could open the
 * dues screen - so this runs on every deploy, right after the migrations.
 *
 * Only roles marked `is_system` are touched. Anything the shop created itself
 * is theirs, and is left exactly as it is.
 */
export async function syncSystemRoles(): Promise<void> {
  const businesses = await db.select({ id: business.id, name: business.name }).from(business)

  for (const b of businesses) {
    for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
      const existing = (
        await db
          .select({ id: role.id, isSystem: role.isSystem })
          .from(role)
          .where(sql`${role.businessId} = ${b.id} and ${role.code} = ${code}`)
          .limit(1)
      )[0]

      if (existing && !existing.isSystem) {
        // Someone renamed a role to a system code. Leave it alone rather than
        // silently overwriting permissions a shop chose for itself.
        console.warn(`  ! ${b.name}: role ${code} is not a system role — skipped`)
        continue
      }

      const id =
        existing?.id ??
        (
          await db
            .insert(role)
            .values({
              businessId: b.id,
              code,
              name: def.name,
              description: def.description,
              isSystem: true,
            })
            .returning()
        )[0]!.id

      await db.delete(rolePermission).where(eq(rolePermission.roleId, id))
      if (def.permissions.length > 0) {
        await db
          .insert(rolePermission)
          .values(def.permissions.map((p) => ({ roleId: id, permissionCode: p })))
      }
    }
    console.log(`  roles synced: ${b.name}`)
  }
}

// Runnable on its own during a deploy.
if (process.argv[1]?.includes('sync-roles')) {
  syncSystemRoles()
    .then(() => {
      console.log('System roles are up to date.')
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error('Role sync failed:', error)
      process.exit(1)
    })
}
