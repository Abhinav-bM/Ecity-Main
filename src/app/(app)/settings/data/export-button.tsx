'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * A plain link, not a fetch.
 *
 * The export streams table by table and can run to hundreds of megabytes on
 * a shop with years of history. Letting the browser handle it means a real
 * progress indicator and a file written to disk as it arrives, rather than a
 * spinner over a response held entirely in memory first.
 */
export function ExportButton() {
  const [started, setStarted] = useState(false)

  return (
    <div className="space-y-2">
      <Button asChild onClick={() => setStarted(true)}>
        <a href="/api/business/export" download>
          <Download className="size-4" /> Download everything
        </a>
      </Button>
      {started ? (
        <p className="text-xs text-muted-foreground" role="status">
          Building the file. A large shop takes a minute — the download starts as it is written.
        </p>
      ) : null}
    </div>
  )
}
