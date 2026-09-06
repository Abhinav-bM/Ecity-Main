import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/server/db'

export const dynamic = 'force-dynamic'

/**
 * How many migrations this build expects, from the journal that ships in the
 * image. Returns null if the journal cannot be read, in which case the check
 * is skipped rather than failing the deploy on a missing file.
 */
async function expectedMigrations(): Promise<number | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8')
    const journal = JSON.parse(raw) as { entries?: unknown[] }
    return Array.isArray(journal.entries) ? journal.entries.length : null
  } catch {
    return null
  }
}

/**
 * Used by the container healthcheck, by the deploy, and by uptime monitoring.
 *
 * It deliberately checks more than "can I reach Postgres". A `select 1` passed
 * happily while every page in the app returned 500, because the release had
 * shipped code that queried a column the database did not have yet - the
 * deploy went green with the site completely down. So this also compares the
 * migrations this build carries against the ones the database has applied.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`)
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'down' }, { status: 503 })
  }

  const expected = await expectedMigrations()
  if (expected !== null) {
    try {
      const rows = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
      )
      const applied = Number((rows as unknown as { n: string }[])[0]?.n ?? 0)
      if (applied < expected) {
        return NextResponse.json(
          {
            status: 'degraded',
            database: 'up',
            schema: 'behind',
            applied,
            expected,
            hint: 'Run the migrations: docker compose --profile tools pull && docker compose run --rm migrate',
          },
          { status: 503 },
        )
      }
      return NextResponse.json({ status: 'ok', database: 'up', schema: 'current', applied })
    } catch {
      // No migrations table yet - a brand new database mid-setup. The
      // connection works, which is all this endpoint can honestly claim.
      return NextResponse.json({ status: 'ok', database: 'up', schema: 'unknown' })
    }
  }

  return NextResponse.json({ status: 'ok', database: 'up' })
}
