'use client'

import { useEffect, useRef } from 'react'
import { Alert } from '@/components/ui/alert'

/**
 * What went wrong, where it will actually be seen.
 *
 * These messages sit at the top of a form, and a form long enough to need
 * scrolling - a purchase with six lines, a device with its specs - puts them
 * off the screen by the time Save is pressed. The button does nothing, no
 * message appears, and the only way to find out why is to scroll back up and
 * guess that something is there.
 *
 * So the message brings itself into view and takes focus, which also makes a
 * screen reader announce it. `role="alert"` alone does not scroll, and a
 * toast alone would leave nothing behind to read a second time. (Alert already
 * carries role="alert"; what it cannot do on its own is scroll.)
 */
export function FormError({ message }: { message: string | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!message) return
    const el = ref.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // preventScroll: the scroll above is the considered one; the browser's
    // own focus scroll would fight it and land somewhere else.
    el.focus({ preventScroll: true })
  }, [message])

  if (!message) return null

  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      {message}
    </Alert>
  )
}
