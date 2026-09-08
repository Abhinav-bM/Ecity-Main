import Link from 'next/link'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The bell (PRD FR-27.3).
 *
 * Server-rendered with its count, so the number is right on first paint
 * rather than appearing a moment later — a badge that pops in after the page
 * has settled is one people learn to stop looking at. It re-renders with the
 * page, which is often enough for alerts a scheduled job raises.
 */
export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative shrink-0"
      aria-label={unread === 0 ? 'Alerts' : `Alerts, ${unread} unread`}
    >
      <Link href="/notifications" data-testid="notification-bell">
        <Bell className="size-4" />
        {unread > 0 ? (
          <span
            data-testid="notification-count"
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-4 text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Link>
    </Button>
  )
}
