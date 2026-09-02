import { switchBranchSchema } from '@/lib/validation'
import { canAccessBranch, AuthorisationError } from '@/server/auth/permissions'
import { setActiveBranch } from '@/server/auth/session'
import { route } from '@/server/http'

/** Branch switcher. The scope check happens here, not in the UI. */
export const POST = route({ schema: switchBranchSchema }, async ({ body, ctx, user }) => {
  if (body.branchId !== null && !canAccessBranch(user, body.branchId)) {
    throw new AuthorisationError('You do not have access to this branch.')
  }
  if (body.branchId === null && !user.canViewAllBranches) {
    throw new AuthorisationError('You cannot view all branches.')
  }
  await setActiveBranch(ctx.sessionId, body.branchId)
  return { ok: true, activeBranchId: body.branchId }
})
