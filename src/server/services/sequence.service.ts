import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/server/db'
import { documentSequence } from '@/server/db/schema'

/**
 * Gapless document numbering (PRD FR-2.2, FR-26.3).
 *
 * The counter row is locked with SELECT ... FOR UPDATE inside the caller's
 * transaction, so two people confirming a purchase in the same second cannot
 * take the same number - the second waits for the first to commit.
 *
 * M4 reuses this for invoices, with a per-branch series where configured.
 */
export async function nextDocumentNumber(
  tx: DbOrTx,
  input: {
    businessId: number
    kind: 'purchase' | 'invoice'
    branchId?: number | null
    prefix: string
  },
): Promise<string> {
  const branchId = input.branchId ?? null

  await tx
    .insert(documentSequence)
    .values({
      businessId: input.businessId,
      kind: input.kind,
      branchId,
      prefix: input.prefix,
      nextNumber: 1,
    })
    // Explicit target, so the insert resolves against the real counter rather
    // than quietly adding another one.
    .onConflictDoNothing({
      target: [documentSequence.businessId, documentSequence.kind, documentSequence.branchId],
    })

  const locked = await tx
    .select({ id: documentSequence.id, nextNumber: documentSequence.nextNumber })
    .from(documentSequence)
    .where(
      and(
        eq(documentSequence.businessId, input.businessId),
        eq(documentSequence.kind, input.kind),
        branchId === null
          ? isNull(documentSequence.branchId)
          : eq(documentSequence.branchId, branchId),
      ),
    )
    .for('update')
    .limit(1)

  const row = locked[0]!
  await tx
    .update(documentSequence)
    .set({ nextNumber: sql`${documentSequence.nextNumber} + 1`, updatedAt: new Date() })
    .where(eq(documentSequence.id, row.id))

  return `${input.prefix}${String(row.nextNumber).padStart(5, '0')}`
}
