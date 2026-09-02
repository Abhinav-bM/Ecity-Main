import { listAccessibleBranches } from '@/server/services/branch.service'
import { route } from '@/server/http'

export const GET = route({ permission: 'branch.view', branchFrom: 'none' }, async ({ user }) =>
  listAccessibleBranches(user),
)
