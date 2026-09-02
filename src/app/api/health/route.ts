import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/server/db'

export const dynamic = 'force-dynamic'

/** Used by the container healthcheck and by uptime monitoring. */
export async function GET() {
  try {
    await db.execute(sql`select 1`)
    return NextResponse.json({ status: 'ok', database: 'up' })
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'down' }, { status: 503 })
  }
}
