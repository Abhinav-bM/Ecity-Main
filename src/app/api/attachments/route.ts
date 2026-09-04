import { NextResponse } from 'next/server'
import { auditContextFromRequest } from '@/server/db/audit'
import {
  isAttachable,
  listAttachments,
  uploadAttachment,
} from '@/server/services/attachment.service'
import { getSessionContext } from '@/server/auth/session'
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
