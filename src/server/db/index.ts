import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/server/env'
import { SHOP_TIME_ZONE } from '@/lib/date'
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
      /*
       * Every connection runs on the shop's clock, not the server's.
       *
       * Timestamps are `timestamptz` and carry their own instant, so most
       * queries do not care. But `current_date` and any `::date` cast resolve
       * against the SESSION timezone - and a production box is conventionally
       * UTC, where the Indian day does not turn over until 05:30. The overdue
       * and warranty-expiry rules in notification.service use both, so on a
       * UTC server they would count a day wrong for five and a half hours
       * every night. Setting it here means the deployment does not have to
       * remember to, on the machine or in the container.
       */
      connection: { TimeZone: SHOP_TIME_ZONE },
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
