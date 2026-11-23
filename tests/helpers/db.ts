import { openDb, type Db } from '../../src/db/open.ts'
import { migrate } from '../../db/migrate.ts'

/**
 * A migrated, empty, in-memory database — one per test, with no cleanup and
 * nothing shared. There is no truncation step because there is nothing to reuse.
 */
export async function freshDb(): Promise<Db> {
  const db = openDb(':memory:')
  await migrate(db)
  return db
}
