import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import { customer, supplier, type Customer, type Supplier } from '@/server/db/schema'
import { diff, writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, conflict, notFound } from '@/server/http'
import type { AuthUser } from '@/server/auth/permissions'

/**
 * Customers and suppliers are the same shape of problem — a searchable
 * directory of people the shop trades with, shared across every branch
 * (PRD FR-6.7, FR-14.3). One generic implementation, two tables, so the
 * duplicate-detection and search rules cannot drift apart.
 */

type PartyTable = typeof customer | typeof supplier
type _Party = Customer | Supplier
type PartyKind = 'customer' | 'supplier'

function tableFor(kind: PartyKind): PartyTable {
  return kind === 'customer' ? customer : supplier
}

export type PartyListQuery = {
  search?: string
  includeInactive?: boolean
  page: number
  pageSize: number
}

export async function listParties(actor: AuthUser, kind: PartyKind, query: PartyListQuery) {
  const t = tableFor(kind)
  const conditions: SQL[] = [eq(t.businessId, actor.businessId)]

  if (!query.includeInactive) conditions.push(eq(t.status, 'ACTIVE'))

  // PRD FR-30.2 searches these by name, phone and email. The M9 global search
  // reuses the same columns, which is why they are indexed.
  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`
    const fields = [
      ilike(t.name, term),
      ilike(t.phone, term),
      ilike(t.email, term),
      ilike(t.gstin, term),
    ]
    if (kind === 'supplier') fields.push(ilike(supplier.company, term))
    conditions.push(or(...fields)!)
  }

  const where = and(...conditions)
  const offset = (query.page - 1) * query.pageSize

  const [rows, totals] = await Promise.all([
    db.select().from(t).where(where).orderBy(asc(t.name)).limit(query.pageSize).offset(offset),
    db.select({ n: count() }).from(t).where(where),
  ])

  return { rows, total: totals[0]?.n ?? 0, page: query.page, pageSize: query.pageSize }
}

/**
 * A row from either table. `company` exists only on suppliers, so it is
 * optional here rather than the union being narrowed at every call site.
 */
export type PartyRecord = Omit<Supplier, 'company'> & { company?: string | null }

export async function getParty(
  actor: AuthUser,
  kind: PartyKind,
  id: number,
): Promise<PartyRecord> {
  const t = tableFor(kind)
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.id, id), eq(t.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0] as PartyRecord | undefined
  if (!row) throw notFound(kind === 'customer' ? 'Customer' : 'Supplier')
  return row
}

/**
 * Duplicate detection. A shop that accumulates three records for the same
 * customer cannot report on them, so this blocks rather than warns — but only
 * on values that genuinely identify someone.
 */
async function assertNoDuplicate(
  actor: AuthUser,
  kind: PartyKind,
  input: { phone?: string | null; gstin?: string | null },
  excludeId?: number,
) {
  const t = tableFor(kind)
  const checks: { field: SQL; label: string }[] = []
  if (input.phone?.trim()) checks.push({ field: eq(t.phone, input.phone.trim()), label: 'phone number' })
  if (input.gstin?.trim()) checks.push({ field: eq(t.gstin, input.gstin.trim()), label: 'GST number' })

  for (const check of checks) {
    const found = await db
      .select({ id: t.id, name: t.name })
      .from(t)
      .where(and(eq(t.businessId, actor.businessId), check.field))
      .limit(1)
    const hit = found[0]
    if (hit && hit.id !== excludeId) {
      throw conflict(
        `Another ${kind} (${hit.name}) already uses this ${check.label}.`,
        { existingId: hit.id },
      )
    }
  }
}

export type PartyInput = {
  name: string
  company?: string
  phone?: string
  altPhone?: string
  email?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  gstin?: string
  notes?: string
}

/** Empty strings from a form are stored as NULL, so "no value" has one shape. */
function normalise(input: PartyInput) {
  const clean = <T extends string | undefined>(v: T) => (v?.trim() ? v.trim() : null)
  return {
    name: input.name.trim(),
    company: clean(input.company),
    phone: clean(input.phone),
    altPhone: clean(input.altPhone),
    email: clean(input.email)?.toLowerCase() ?? null,
    addressLine1: clean(input.addressLine1),
    addressLine2: clean(input.addressLine2),
    city: clean(input.city),
    state: clean(input.state),
    pincode: clean(input.pincode),
    gstin: clean(input.gstin)?.toUpperCase() ?? null,
    notes: clean(input.notes),
  }
}

export async function createParty(
  actor: AuthUser,
  ctx: AuditContext,
  kind: PartyKind,
  input: PartyInput,
) {
  const values = normalise(input)
  await assertNoDuplicate(actor, kind, values)

  const t = tableFor(kind)
  // `company` exists only on supplier.
  const { company, ...shared } = values
  const payload = kind === 'supplier' ? { ...shared, company } : shared

  const created = (
    await db
      .insert(t)
      .values({
        businessId: actor.businessId,
        ...payload,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning()
  )[0]!

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: kind,
    entityId: created.id,
    summary: `Created ${kind} ${created.name}`,
    changes: diff(null, { name: created.name, phone: created.phone, email: created.email }),
  })
  return { id: created.id }
}

export async function updateParty(
  actor: AuthUser,
  ctx: AuditContext,
  kind: PartyKind,
  id: number,
  input: PartyInput,
) {
  const before = await getParty(actor, kind, id)
  const values = normalise(input)
  await assertNoDuplicate(actor, kind, values, id)

  const t = tableFor(kind)
  const { company, ...shared } = values
  const payload = kind === 'supplier' ? { ...shared, company } : shared

  await db
    .update(t)
    .set({ ...payload, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(t.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: kind,
    entityId: id,
    summary: `Updated ${kind} ${values.name}`,
    changes: diff(before, payload),
  })
}

/**
 * Deactivation, never deletion (docs/02 §2.2 rule 4). An inactive party is
 * hidden from new-transaction pickers but every historical record still
 * points at it and still reads correctly.
 */
export async function setPartyStatus(
  actor: AuthUser,
  ctx: AuditContext,
  kind: PartyKind,
  id: number,
  status: 'ACTIVE' | 'INACTIVE',
) {
  const before = await getParty(actor, kind, id)
  if (before.status === status) return

  const t = tableFor(kind)
  await db.update(t).set({ status, updatedAt: new Date(), updatedBy: actor.id }).where(eq(t.id, id))

  await writeAudit(ctx, {
    action: 'UPDATE',
    entityType: kind,
    entityId: id,
    summary: `${status === 'ACTIVE' ? 'Reactivated' : 'Deactivated'} ${kind} ${before.name}`,
    changes: diff({ status: before.status }, { status }),
  })
}

/** Guard used by later modules before attaching a party to a document. */
export async function assertPartySelectable(actor: AuthUser, kind: PartyKind, id: number) {
  const row = await getParty(actor, kind, id)
  if (row.status !== 'ACTIVE') {
    throw new AppError(
      `${row.name} is deactivated and cannot be used on a new transaction.`,
      422,
      'PARTY_INACTIVE',
    )
  }
  return row
}
