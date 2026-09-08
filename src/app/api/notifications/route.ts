import { z } from 'zod'
import {
  evaluateRules,
  listNotifications,
  markAllRead,
  markRead,
} from '@/server/services/notification.service'
import { route } from '@/server/http'

/** PRD FR-27. The bell, and what is behind it. */
export const GET = route({ permission: 'notification.view', branchFrom: 'none' }, ({ user }) =>
  listNotifications(user),
)

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), ids: z.array(z.coerce.number().int().positive()).min(1) }),
  z.object({ action: z.literal('readAll') }),
  /*
   * Checking now rather than waiting for the worker. Anyone who can see
   * alerts may ask for a refresh: it writes nothing a scheduled run would not
   * have written a few minutes later, and the alternative is a screen that
   * looks stale and cannot be made fresh.
   */
  z.object({ action: z.literal('evaluate') }),
])

export const POST = route(
  { permission: 'notification.view', branchFrom: 'none', schema },
  async ({ user, body }) => {
    if (body.action === 'read') return { read: await markRead(user, body.ids) }
    if (body.action === 'readAll') return { read: await markAllRead(user) }
    return evaluateRules(user.businessId)
  },
)
