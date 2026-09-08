import { z } from 'zod'
import { exportReport } from '@/server/services/export.service'
import { buildReport, REPORTS, type ReportName } from '@/server/services/reports.service'
import { route } from '@/server/http'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date.')

const schema = z.object({
  report: z.enum(Object.keys(REPORTS) as [ReportName, ...ReportName[]]),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  from: isoDate,
  to: isoDate,
  branchId: z.coerce.number().int().positive().optional(),
})

/**
 * PRD FR-33. One endpoint for every report and every format.
 *
 * The report decides its own columns and rows; the export layer turns that
 * into a file. Adding a report gets three formats, and adding a format gets
 * every report.
 */
export const GET = route(
  { permission: 'analytics.view', branchFrom: 'none', schema },
  async ({ user, body }) => {
    const range = {
      from: body.from,
      to: body.to,
      branchIds: body.branchId ? [body.branchId] : undefined,
    }
    const spec = await buildReport(user, body.report, range)
    return exportReport(user, spec, body.format, range)
  },
)
