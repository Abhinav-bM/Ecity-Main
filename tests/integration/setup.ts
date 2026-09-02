import postgres from 'postgres'

/**
 * Integration tests need a real Postgres. They run in CI (which provides one)
 * and locally once `docker compose up -d` is running. When no database is
 * reachable they skip loudly rather than failing, so `npm test` stays useful
 * on a machine without Docker.
 */
export async function databaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url || url.includes('unused')) return false
  try {
    const sql = postgres(url, { max: 1, connect_timeout: 3 })
    await sql`select 1`
    await sql.end()
    return true
  } catch {
    return false
  }
}
