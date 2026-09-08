import { z } from 'zod'
import { auditContextFromRequest } from '@/server/db/audit'
import { listSavedReports, saveReport } from '@/server/services/saved-report.service'
import { route } from '@/server/http'

/** M11. The filters someone comes back to, not the figures. */
const schema = z.object({
  name: z.string().trim().min(1, 'Give the view a name.').max(60),
  report: z.string().trim().min(1).max(40),
  filters: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      branchId: z.string().optional(),
    })
    .default({}),
  isShared: z.boolean().default(false),
})

export const GET = route({ permission: 'analytics.view', branchFrom: 'none' }, ({ user }) =>
  listSavedReports(user),
)

export const POST = route(
  { permission: 'analytics.view', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const audit = await auditContextFromRequest(user, user.businessId, null)
    return saveReport(user, audit, body)
  },
)
