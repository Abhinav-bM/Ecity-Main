import { z } from 'zod'
import { rupeeAmount, rupeesToPaise } from '@/lib/validation'
import {
  ALL_KINDS,
  listRules,
  setMuted,
  setRule,
  type NotificationKind,
} from '@/server/services/notification.service'
import { AppError, route } from '@/server/http'
import { hasPermission } from '@/server/auth/permissions'

export const GET = route({ permission: 'notification.view', branchFrom: 'none' }, ({ user }) =>
  listRules(user),
)

const schema = z.object({
  kind: z.enum(ALL_KINDS as [NotificationKind, ...NotificationKind[]]),
  /** Mine only — muting your own bell needs no permission. */
  mutedForMe: z.boolean().optional(),
  /** The shop's setting — needs notification.manage. */
  isEnabled: z.boolean().optional(),
  thresholdDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  thresholdRupees: rupeeAmount({ max: 10_000_000 }).nullable().optional(),
})

export const PATCH = route(
  { permission: 'notification.view', branchFrom: 'none', schema },
  async ({ user, body }) => {
    if (body.mutedForMe !== undefined) {
      await setMuted(user, body.kind, body.mutedForMe)
    }

    const changesShopSetting =
      body.isEnabled !== undefined ||
      body.thresholdDays !== undefined ||
      body.thresholdRupees !== undefined
    if (changesShopSetting) {
      if (!hasPermission(user, 'notification.manage')) {
        throw new AppError(
          'Changing what the shop is alerted about needs permission. You can still mute it for yourself.',
          403,
          'FORBIDDEN',
        )
      }
      await setRule(user, body.kind, {
        isEnabled: body.isEnabled ?? true,
        thresholdDays: body.thresholdDays ?? null,
        thresholdPaise:
          body.thresholdRupees == null ? null : rupeesToPaise(body.thresholdRupees),
      })
    }

    return { ok: true }
  },
)
