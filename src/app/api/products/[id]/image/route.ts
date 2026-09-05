import { NextResponse } from 'next/server'
import { auditContextFromRequest } from '@/server/db/audit'
import { uploadAttachment } from '@/server/services/attachment.service'
import { setProductImage } from '@/server/services/product.service'
import { getSessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { AppError, route, toResponse } from '@/server/http'

function idFrom(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid product id.', 400)
  return id
}

/**
 * Multipart, so it sits outside the JSON `route()` wrapper. The file goes
 * through the same storage layer and signed-URL scheme as every other
 * attachment; only the resulting URL is copied onto the product.
 */
export async function POST(
  req: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  try {
    const session = await getSessionContext()
    if (!session) {
      return NextResponse.json({ error: 'Not signed in.', code: 'UNAUTHENTICATED' }, { status: 401 })
    }
    requirePermission(session.user, 'product.manage', null)

    const id = idFrom(await context.params)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new AppError('No file supplied.', 400)
    if (!file.type.startsWith('image/')) {
      throw new AppError('A product image must be a picture.', 422, 'NOT_AN_IMAGE')
    }

    const audit = await auditContextFromRequest(
      session.user,
      session.user.businessId,
      session.activeBranchId,
    )
    const uploaded = await uploadAttachment(session.user, audit, {
      entityType: 'product',
      entityId: id,
      file,
    })
    await setProductImage(session.user, audit, id, uploaded.url)
    return NextResponse.json({ ok: true, url: uploaded.url })
  } catch (error) {
    return toResponse(error)
  }
}

export const DELETE = route(
  { permission: 'product.manage', branchFrom: 'none' },
  async ({ user, params, ctx }) => {
    const audit = await auditContextFromRequest(user, user.businessId, ctx.activeBranchId)
    await setProductImage(user, audit, idFrom(params), null)
    return { ok: true }
  },
)
