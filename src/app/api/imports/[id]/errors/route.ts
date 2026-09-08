import { z } from 'zod'
import { errorReport } from '@/server/services/import.service'
import { exportReport } from '@/server/services/export.service'
import { AppError, route } from '@/server/http'

/**
 * PRD FR-34.2. The per-row error report, as a file.
 *
 * Downloadable rather than only on screen: someone fixing 20 bad rows in a
 * spreadsheet of 1,000 needs the list beside the file, not in another tab.
 */
export const GET = route(
  {
    permission: 'product.manage',
    branchFrom: 'none',
    schema: z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }),
  },
  async ({ user, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid import id.', 400)
    const spec = await errorReport(user, id)
    return exportReport(user, spec, body.format, { importId: id })
  },
)
