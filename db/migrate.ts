import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Db } from '../src/db/open.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Applies every unapplied .sql file in filename order. Returns the ones applied. */
export async function migrate(db: Db, dir = join(HERE, 'migrations')): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migration (
      filename   text primary key,
      applied_at text not null
    ) strict
  `)

  const rows = await db.all<{ filename: string }>('select filename from schema_migration')
  const done = new Set(rows.map(r => r.filename))

  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  const applied: string[] = []

  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(dir, file), 'utf8')
    try {
      // SQLite makes DDL transactional, so a broken file leaves nothing behind.
      await db.tx(async () => {
        await db.exec(sql)
        await db.run('insert into schema_migration (filename, applied_at) values (?, ?)',
                     [file, new Date().toISOString()])
      })
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
    applied.push(file)
  }
  return applied
}

if (import.meta.filename === process.argv[1]) {
  const { openDb } = await import('../src/db/open.ts')
  const { databaseFile } = await import('../src/seed/brand.ts')
  const db = openDb(databaseFile())
  const applied = await migrate(db)
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply')
  await db.close()
}
