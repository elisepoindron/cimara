import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../helpers/db.ts'
import { PRIVATE_NAME } from '../../src/import/osm/never-named.ts'
import { insertAccount } from '../../src/db/account.ts'
import { assertHoldsNobody, demoDatabaseFile, NotADemoDatabase } from '../../src/import/osm/guard.ts'

test('the demo importer needs a database named for it', () => {
  assert.throws(() => demoDatabaseFile({}), NotADemoDatabase)
  assert.throws(() => demoDatabaseFile({ DATABASE_FILE: '  ' }), /not set/)
  assert.throws(() => demoDatabaseFile({ DATABASE_FILE: `${PRIVATE_NAME}.db` }), /private archive/)
  assert.throws(() => demoDatabaseFile({ DATABASE_FILE: `/data/${PRIVATE_NAME}.db` }), /private archive/)
  assert.throws(() => demoDatabaseFile({ DATABASE_FILE: `./${PRIVATE_NAME.toUpperCase()}.DB` }), /private archive/)
  assert.equal(demoDatabaseFile({ DATABASE_FILE: 'build/demo.db' }), 'build/demo.db')
})

test('a database people use is refused even under another name', async () => {
  const db = await freshDb()
  await assertHoldsNobody(db, 'scratch.db')
  await insertAccount(db, { id: 'a1', email: 'a@example.invalid', passwordHash: 'x', displayName: 'A' })
  await assert.rejects(assertHoldsNobody(db, 'scratch.db'), NotADemoDatabase)
})

test('the script refuses to start, and says why, before opening anything', () => {
  const script = fileURLToPath(new URL('../../scripts/osm/import.ts', import.meta.url))
  for (const env of [{}, { DATABASE_FILE: `${PRIVATE_NAME}.db` }]) {
    const { DATABASE_FILE: _, ...rest } = process.env
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, '/nonexistent'], {
      env: { ...rest, ...env }, encoding: 'utf8', cwd: fileURLToPath(new URL('../fixtures/osm/', import.meta.url)),
    })
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /^Refused: DATABASE_FILE/)
  }
})
