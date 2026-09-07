import 'dotenv/config'
import { purgeExpiredSessions } from '@/server/auth/session'
import { logger } from '@/server/logger'

/**
 * Background worker. Runs as its own container beside the app
 * (docs/04 §4.1). pg-boss is introduced properly in M13; for now this is
 * a simple interval loop that keeps the session table tidy.
 */
const HOUR = 3_600_000

async function tick() {
  try {
    const removed = await purgeExpiredSessions()
    if (removed > 0) logger.info({ removed }, 'Purged expired sessions')
  } catch (error) {
    logger.error({ err: error }, 'Session purge failed')
  }
}

logger.info('Worker started')
void tick()
setInterval(() => void tick(), HOUR)
