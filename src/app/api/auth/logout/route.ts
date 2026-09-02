import { clearSessionCookie, revokeSession } from '@/server/auth/session'
import { auditContextFromRequest, writeAudit } from '@/server/db/audit'
import { route } from '@/server/http'

export const POST = route({}, async ({ ctx, user }) => {
  await revokeSession(ctx.sessionId)
  await clearSessionCookie()
  await writeAudit(await auditContextFromRequest(user, user.businessId, ctx.activeBranchId), {
    action: 'LOGOUT',
    entityType: 'app_user',
    entityId: user.id,
    summary: 'Signed out',
  })
  return { ok: true }
})
