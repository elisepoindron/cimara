import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { ASPECT_LABELS } from '../../src/domain/quantity.ts'

// Aspects have two independent copies — one in src/domain, one as a check
// constraint in a migration — with nothing else to keep them in step. If a
// copy drifts, a value the domain considers valid gets rejected by the
// database. This inserts every domain-declared member and confirms the schema
// accepts it.

test('the verdict and the tables that held it are gone (migration 020)', async () => {
  const db = await freshDb()
  const cols = async (t: string) => (await db.all<{ name: string }>(`select name from pragma_table_info(?)`, [t])).map(c => c.name)
  assert.equal((await cols('observation')).length, 0, 'no observation table')
  assert.equal((await cols('gita')).some(c => c === 'verdict' || c === 'measures'), false)
  assert.equal((await cols('imported_report')).includes('verdict'), false)
})

test('every ASPECT_LABELS key is accepted by the itinerary check constraint', async () => {
  const db = await freshDb()
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])

  const aspects = Object.keys(ASPECT_LABELS)
  for (const aspect of aspects) {
    await db.run(`insert into itinerary (id, activity, place_id, name, aspect, created)
                  values (?, 'alpinismo', ?, ?, ?, ?)`,
                 [crypto.randomUUID(), place, `Via ${aspect}`, aspect, new Date().toISOString()])
  }

  const rows = await db.all<{ aspect: string }>(`select aspect from itinerary`)
  assert.deepEqual(rows.map(r => r.aspect).sort(), aspects.sort())
})
