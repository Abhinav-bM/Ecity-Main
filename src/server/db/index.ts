import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/server/env'
import * as schema from './schema'

/**
 * One small connection pool for a long-running Node process.
 * Deliberately NOT serverless - see docs/03 §2.1 and §7.
 *
 * The client is created lazily so that importing a module which merely
 * *mentions* the database does not require DATABASE_URL. That keeps pure
 * logic (permissions, diffing, validation) unit-testable without a database.
 */
type Drizzle = ReturnType<typeof drizzle<typeof schema>>

const globalForDb = globalThis as unknown as {
  __ecitySql?: ReturnType<typeof postgres>
  __ecityDb?: Drizzle
}

function connect(): Drizzle {
  if (!globalForDb.__ecityDb) {
    globalForDb.__ecitySql ??= postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    })
    globalForDb.__ecityDb = drizzle(globalForDb.__ecitySql, { schema })
  }
  return globalForDb.__ecityDb
}

export const db: Drizzle = new Proxy({} as Drizzle, {
  get(_target, prop, receiver) {
    const real = connect()
    const value = Reflect.get(real as object, prop, receiver)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

export type Db = Drizzle
/** A transaction handle, for services that must accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]
export { schema }
