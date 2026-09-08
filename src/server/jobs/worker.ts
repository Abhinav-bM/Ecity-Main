import 'dotenv/config'
import { db } from '@/server/db'
import { business } from '@/server/db/schema'
import { purgeExpiredSessions } from '@/server/auth/session'
import { evaluateRules } from '@/server/services/notification.service'
import { logger } from '@/server/logger'

/**
 * Background worker. Runs as its own container beside the app (docs/04 §4.1).
 *
 * Still an interval loop rather than pg-boss. M13 planned to introduce it,
 * and the two jobs there are - tidy sessions, evaluate the alert rules - are
 * both idempotent, cheap, and safe to miss and repeat. A queue buys retries,
 * scheduling and a dashboard for jobs that have none of those problems, and
 * costs a table, a migration and a second thing to keep running. Reach for it
 * at the first job that must not be lost.
 */
const HOUR = 3_600_000

async function tick() {
  try {
    const removed = await purgeExpiredSessions()
    if (removed > 0) logger.info({ removed }, 'Purged expired sessions')
  } catch (error) {
    logger.error({ err: error }, 'Session purge failed')
  }

  /*
   * PRD FR-27.1. Every business, one at a time: a slow query on one shop's
   * data must not stop another's alerts, and the loop is short enough that
   * running them in parallel would only add contention.
   */
  try {
    const businesses = await db.select({ id: business.id }).from(business)

    for (const row of businesses) {
      try {
        const result = await evaluateRules(row.id)
        const raised = Object.values(result).reduce((n, r) => n + r.raised, 0)
        const resolved = Object.values(result).reduce((n, r) => n + r.resolved, 0)
        if (raised || resolved) {
          logger.info({ businessId: row.id, raised, resolved }, 'Alerts evaluated')
        }
      } catch (error) {
        logger.error({ err: error, businessId: row.id }, 'Alert evaluation failed')
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Could not list businesses for alerts')
  }
}

logger.info('Worker started')
void tick()
setInterval(() => void tick(), HOUR)
