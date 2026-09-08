import {
  businessExportSummary,
  streamBusinessExport,
} from '@/server/services/business-export.service'
import { route } from '@/server/http'

/**
 * PRD FR-32.3. The owner's own copy of everything.
 *
 * Behind `business.manage`, which only the owner holds: this is every
 * customer, every price and every figure the shop has, in one file.
 */
export const GET = route(
  { permission: 'business.manage', branchFrom: 'none' },
  async ({ user, req }) => {
    const url = new URL(req.url)
    // The summary is what the screen shows first, so nobody starts a large
    // download to find out what is in it.
    if (url.searchParams.get('summary') === 'true') {
      return businessExportSummary(user)
    }
    return streamBusinessExport(user)
  },
)
