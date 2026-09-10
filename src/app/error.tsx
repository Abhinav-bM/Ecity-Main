'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * The last thing between a thrown exception and a blank page.
 *
 * Next.js renders this in place of any route segment whose server or client
 * code throws. Without one, a page that fails - the database refusing a
 * connection, a query hitting a column that is not there yet - showed the
 * production error screen, which tells the person at the counter nothing and
 * offers them no way out.
 *
 * `reset()` re-renders the segment without a full page load, so a failure that
 * was momentary (a dropped connection, a restart mid-deploy) is one press away
 * from working again.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    // The server logs the real error with its stack; this is what ties the
    // digest the user can see to the line in the log.
    console.error('Route error', error.digest ?? '', error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">
                This screen could not be loaded
              </h1>
              <p className="text-sm text-muted-foreground">
                Nothing you had entered has been sent, and nothing has been saved. Try again —
                if it keeps happening, quote the reference below.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => reset()} size="sm">
              <RotateCw className="size-4" />
              Try again
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
              Back to the dashboard
            </Button>
          </div>

          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
