import { basename } from 'node:path'
import type { Db } from '../../db/open.ts'
import { holdsPeople } from '../../db/account.ts'
import { PRIVATE_NAME } from './never-named.ts'

/**
 * The OpenStreetMap importer builds the public demo's database and nothing
 * else. It must never write into the private archive, whose file is the private
 * set's database, and which holds real people's accounts and gite.
 *
 * Two locks, each enough alone:
 *   - the file must be named, never defaulted, and never the app's default;
 *   - the database must hold nobody: no account, no gita.
 */
export class NotADemoDatabase extends Error {}

/** The file the private set's deploy opens: the archive, not a demo. */
const APP_DEFAULT = `${PRIVATE_NAME}.db`

export function demoDatabaseFile(env: Readonly<Record<string, string | undefined>>): string {
  const file = env.DATABASE_FILE?.trim()
  if (!file) {
    throw new NotADemoDatabase('DATABASE_FILE is not set. The demo importer never falls back to the app\'s '
      + 'default database, which is the private archive: name a scratch file, e.g. DATABASE_FILE=build/demo.db')
  }
  if (file === ':memory:') return file
  if (basename(file).toLowerCase() === APP_DEFAULT) {
    throw new NotADemoDatabase(`DATABASE_FILE names ${file}, the app's default database, which is the private `
      + 'archive. The demo importer writes only into a database of its own: name another file')
  }
  return file
}

/** Refuses a database somebody has used: accounts or gite mean an archive, not a demo build. */
export async function assertHoldsNobody(db: Db, file: string): Promise<void> {
  if (await holdsPeople(db)) {
    throw new NotADemoDatabase(`${file} holds accounts or gite: it is an archive people use, not a demo build. `
      + 'The demo importer writes nothing into it')
  }
}
