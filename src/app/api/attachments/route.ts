import { NextResponse } from 'next/server'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  isAttachable,
  listAttachments,
  uploadAttachment,
} from '@/server/services/attachment.service'
import { getSessionContext } from '@/server/auth/session'
import { MAX_UPLOAD_BYTES } from '@/server/storage'
import { requirePermission } from '@/server/auth/permissions'
import { AppError, route, toResponse } from '@/server/http'

export const GET = route({ branchFrom: 'none' }, async ({ req, user }) => {
  const url = new URL(req.url)
  const entityType = url.searchParams.get('entityType') ?? ''
  const entityId = Number(url.searchParams.get('entityId'))
  if (!isAttachable(entityType)) throw new AppError('Unknown entity type.', 400)
  if (!Number.isInteger(entityId) || entityId <= 0) throw new AppError('Invalid entity id.', 400)
  return listAttachments(user, entityType, entityId)
})

/**
 * Multipart upload. Handled outside the `route()` wrapper because that parses
 * JSON, and a file upload is a form body.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getSessionContext()
    if (!session) {
      return NextResponse.json({ error: 'Not signed in.', code: 'UNAUTHENTICATED' }, { status: 401 })
    }
    requirePermission(session.user, 'attachment.upload', null)

    /*
     * Refuse an oversized upload before reading it.
     *
     * `req.formData()` buffers the whole body first, so without this a 500 MB
     * post is held in memory and only then rejected by the 5 MB rule — which
     * on a 1 GB server is a way to take the shop offline by uploading a film.
     * The header is a hint, not a guarantee, so the real check still runs
     * below on the actual bytes; this one just stops the obvious case cheaply.
     */
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > MAX_UPLOAD_BYTES * 1.1) {
      throw new AppError(
        `That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        413,
        'FILE_TOO_LARGE',
      )
    }

    const form = await req.formData()
    const entityType = String(form.get('entityType') ?? '')
    const entityId = Number(form.get('entityId'))
    const file = form.get('file')

    if (!isAttachable(entityType)) throw new AppError('Unknown entity type.', 400)
    if (!Number.isInteger(entityId) || entityId <= 0) throw new AppError('Invalid entity id.', 400)
    if (!(file instanceof File)) throw new AppError('No file supplied.', 400)

    const audit = await auditContextFromRequest(
      session.user,
      session.user.businessId,
      session.activeBranchId,
    )
    const result = await uploadAttachment(session.user, audit, { entityType, entityId, file })
    return NextResponse.json(result)
  } catch (error) {
    return toResponse(error)
  }
}
