import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { attachment } from '@/server/db/schema'
import { writeAudit, type AuditContext } from '@/server/db/audit'
import { AppError, notFound } from '@/server/http'
import {
  newStorageKey,
  signedUrl,
  storage,
  uploadProblems,
} from '@/server/storage'
import type { AuthUser } from '@/server/auth/permissions'

/** Entities that may carry files. Keeps entityType from becoming free text. */
export const ATTACHABLE = [
  'customer',
  'supplier',
  'branch',
  'business',
  'product',
  // PRD FR-5.13 - supplier bills, photos and PDFs against a purchase.
  'purchase',
  // PRD FR-10.2 - the receipt for an expense.
  'expense',
  // PRD M8 - evidence for a stock adjustment: a photo of the damage, a note.
  'stock_adjustment',
] as const
export type Attachable = (typeof ATTACHABLE)[number]

export function isAttachable(value: string): value is Attachable {
  return (ATTACHABLE as readonly string[]).includes(value)
}

export async function listAttachments(actor: AuthUser, entityType: Attachable, entityId: number) {
  const rows = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.businessId, actor.businessId),
        eq(attachment.entityType, entityType),
        eq(attachment.entityId, entityId),
      ),
    )
    .orderBy(desc(attachment.createdAt))

  // Signed URLs are minted per request and expire in minutes, so they are
  // safe to hand to the browser but useless if copied elsewhere later.
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt,
    url: signedUrl(r.storageKey),
  }))
}

export async function uploadAttachment(
  actor: AuthUser,
  ctx: AuditContext,
  input: { entityType: Attachable; entityId: number; file: File },
) {
  const problems = uploadProblems({ size: input.file.size, type: input.file.type })
  if (problems.length > 0) {
    throw new AppError(problems.join(' '), 422, 'INVALID_UPLOAD', { problems })
  }

  const key = newStorageKey(actor.businessId, input.entityType, input.file.name)
  const body = Buffer.from(await input.file.arrayBuffer())
  await storage().put(key, body, input.file.type)

  /*
   * The object is in the bucket before the row that points at it exists, and
   * it has to be that way round - a row referring to a file that failed to
   * upload is worse than a file nothing refers to.
   *
   * But a failure here (a lost connection, a constraint) used to leave that
   * object behind for ever: nothing references it, nothing lists it, and
   * storage is charged by the gigabyte. So the upload is undone before the
   * error goes on its way.
   */
  let created
  try {
    created = (
      await db
        .insert(attachment)
        .values({
          businessId: actor.businessId,
          entityType: input.entityType,
          entityId: input.entityId,
          fileName: input.file.name.slice(0, 200),
          contentType: input.file.type,
          sizeBytes: input.file.size,
          storageKey: key,
          uploadedBy: actor.id,
        })
        .returning()
    )[0]!
  } catch (error) {
    // Best effort: if the tidy-up also fails there is nothing further to try,
    // and the original error is the one worth reporting.
    await storage().delete(key).catch(() => undefined)
    throw error
  }

  await writeAudit(ctx, {
    action: 'CREATE',
    entityType: 'attachment',
    entityId: created.id,
    summary: `Attached ${created.fileName} to ${input.entityType} #${input.entityId}`,
  })

  return { id: created.id, fileName: created.fileName, url: signedUrl(key) }
}

export async function deleteAttachment(actor: AuthUser, ctx: AuditContext, id: number) {
  const rows = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.id, id), eq(attachment.businessId, actor.businessId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Attachment')

  // The row goes and the object goes. Attachments carry no financial history
  // of their own, so rule 4 (never hard-delete) does not apply here - the
  // audit entry is what preserves the record that it existed.
  await db.delete(attachment).where(eq(attachment.id, id))
  await storage().delete(row.storageKey)

  await writeAudit(ctx, {
    action: 'DELETE',
    entityType: 'attachment',
    entityId: id,
    summary: `Removed ${row.fileName} from ${row.entityType} #${row.entityId}`,
  })
}

export async function findByStorageKey(key: string) {
  const rows = await db
    .select()
    .from(attachment)
    .where(eq(attachment.storageKey, key))
    .limit(1)
  return rows[0] ?? null
}
