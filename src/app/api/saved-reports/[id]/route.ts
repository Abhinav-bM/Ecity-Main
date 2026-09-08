import { auditContextFromRequest } from '@/server/db/audit'
import { deleteSavedReport } from '@/server/services/saved-report.service'
import { route } from '@/server/http'

export const DELETE = route(
  { permission: 'analytics.view', branchFrom: 'none' },
  async ({ user, params }) => {
    const audit = await auditContextFromRequest(user, user.businessId, null)
    return deleteSavedReport(user, audit, Number(params.id))
  },
)
