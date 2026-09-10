'use client'

import { useEffect } from 'react'
import './globals.css'

/**
 * The boundary for a failure in the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot help when the
 * root layout is what threw - that case produced a genuinely blank page. This
 * one replaces the whole document, so it has to bring its own <html> and
 * <body>, and it deliberately depends on nothing but React: whatever broke may
 * well be one of the things a fancier page would import.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Root layout error', error.digest ?? '', error)
  }, [error])

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div style={{ maxWidth: '32rem', margin: '4rem auto', padding: '0 1.5rem' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            ECITY could not start
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '1rem' }}>
            Something failed before the app could be drawn. Nothing has been saved. Try again, and
            if it keeps happening quote the reference below to whoever looks after the system.
          </p>
          <button
            onClick={() => reset()}
            style={{
              fontSize: '0.875rem',
              padding: '0.5rem 0.875rem',
              borderRadius: '0.5rem',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: '0.75rem', marginTop: '1rem', fontFamily: 'monospace' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
