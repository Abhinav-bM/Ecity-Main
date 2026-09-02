import { auditQuerySchema } from '@/lib/validation'
import { listAuditLog } from '@/server/services/audit.service'
import { route } from '@/server/http'

export const GET = route(
  { permission: 'audit.view', branchFrom: 'none', schema: auditQuerySchema },
  async ({ user, body }) => listAuditLog(user, body),
)
