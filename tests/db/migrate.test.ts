import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/db/open.ts'
import { migrate } from '../../db/migrate.ts'

/**
 * A temp directory of migration files, removed when the test ends. Left
 * uncleaned, these accumulate silently — 222 had piled up on one machine
 * before this cleanup was added.
 */
async function migrationsIn(t: TestContext, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'app-mig-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql)
  return dir
}

test('migrate applies files in filename order, and only once', async (t) => {
  const db = openDb(':memory:')
  const dir = await migrationsIn(t, {
    '002_second.sql': 'create table b (id text primary key) strict;',
    '001_first.sql':  'create table a (id text primary key) strict;',
  })

  assert.deepEqual(await migrate(db, dir), ['001_first.sql', '002_second.sql'])
  assert.deepEqual(await migrate(db, dir), [], 'a second run applies nothing')

  const tables = await db.all<{ name: string }>(
    `select name from sqlite_master where type = 'table' order by name`)
  assert.deepEqual(tables.map(t => t.name).filter(n => n !== 'schema_migration'), ['a', 'b'])
})

test('a failing migration rolls back and names the file that broke', async (t) => {
  const db = openDb(':memory:')
  const dir = await migrationsIn(t, {
    '001_ok.sql':  'create table a (id text primary key) strict;',
    '002_bad.sql': 'create table b (this is not sql);',
  })

  await assert.rejects(migrate(db, dir), /002_bad\.sql/)
  assert.deepEqual(
    await db.all(`select name from sqlite_master where name = 'b'`), [],
    'nothing from the failing file survives')
})

test('a connection opens with the settings production needs', async () => {
  const db = openDb(':memory:')
  const first = async (sql: string) =>
    Object.values((await db.all<Record<string, number>>(sql))[0] ?? {})[0]

  assert.equal(await first('pragma busy_timeout'), 5000)
  assert.equal(await first('pragma foreign_keys'), 1)

  // Migrations run inside `db.tx`, and SQLite silently ignores a pragma change
  // made there — which is why 006's observation rebuild needs no foreign_keys
  // dance around the drop-and-rename.
  await db.tx(async () => { await db.exec('pragma foreign_keys = OFF') })
  assert.equal(await first('pragma foreign_keys'), 1, 'the pragma is a no-op inside a transaction')
})

test('a file-backed connection actually turns on WAL and NORMAL synchronous', async (t) => {
  // ':memory:' cannot do WAL at all, so every other test in this suite exercises
  // openDb() without ever proving these two pragmas take effect on a real file.
  const dir = await mkdtemp(join(tmpdir(), 'app-db-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const db = openDb(join(dir, 'app.db'))
  const first = async (sql: string) =>
    Object.values((await db.all<Record<string, string | number>>(sql))[0] ?? {})[0]

  assert.equal(await first('pragma journal_mode'), 'wal')
  assert.equal(await first('pragma synchronous'), 1, 'NORMAL')

  await db.close()
})

test('the gita_photo table exists with the columns photos need', async () => {
  const db = openDb(':memory:')
  await migrate(db)

  const cols = await db.all<{ name: string }>('pragma table_info(gita_photo)')
  const names = cols.map(c => c.name)
  assert.deepEqual(names, ['id', 'gita_id', 'position', 'caption', 'mime', 'width', 'height'])
})
