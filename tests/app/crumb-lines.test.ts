import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { crumbLines, find } from '../../src/app/find.ts'
import { ancestorsOf, insertPlace } from '../../src/db/place.ts'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const FALESIA = { id: 'falesia', label: 'Falesia' }

async function italy() {
  const db = await freshDb()
  await insertPlace(db, { id: 'pie', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertPlace(db, { id: 'ven', name: 'Veneto', kind: 'regione', parentId: null })
  await insertPlace(db, { id: 'to', name: 'TO', kind: 'provincia', parentId: 'pie' })
  await insertPlace(db, { id: 'pd', name: 'PD', kind: 'provincia', parentId: 'ven' })
  await insertPlace(db, { id: 'bus', name: 'Bussoleno', kind: 'comune', parentId: 'to' })
  // Two comuni of one name; the parser takes the first by id, so `samone-tn` wins.
  await insertPlace(db, { id: 'samone-to', name: 'Samone', kind: 'comune', parentId: 'to' })
  await insertPlace(db, { id: 'samone-tn', name: 'Samone', kind: 'comune', parentId: null })
  await insertPlace(db, { id: 'abano', name: 'Abano Terme', kind: 'comune', parentId: 'pd' })
  return db
}

test('every place of an unambiguous breadcrumb gets the line that names it', async () => {
  const db = await italy()
  const lines = await crumbLines(db, FALESIA, await ancestorsOf(db, 'bus'))

  assert.deepEqual([...lines], [
    ['pie', 'Falesia Piemonte'], ['to', 'Falesia TO'], ['bus', 'Falesia Bussoleno'],
  ])
})

test('each line is one Find reads back as that activity in that place', async () => {
  const db = await italy()
  for (const [id, line] of await crumbLines(db, FALESIA, await ancestorsOf(db, 'bus'))) {
    const r = await find(db, line, NOW)
    assert.deepEqual(r.constraints.map(c => (c.kind === 'place' ? `place:${c.id}` : c.kind)),
      ['activity', `place:${id}`], line)
  }
})

test('a comune whose name Find would read as its namesake is left without a line', async () => {
  const db = await italy()
  const lines = await crumbLines(db, FALESIA, await ancestorsOf(db, 'samone-to'))

  assert.equal(lines.has('samone-to'), false, 'Falesia Samone is the other Samone')
  assert.equal(lines.get('to'), 'Falesia TO', 'the province above it still links')
})

test('the namesake Find does pick keeps its line', async () => {
  const db = await italy()
  const lines = await crumbLines(db, FALESIA, await ancestorsOf(db, 'samone-tn'))
  assert.equal(lines.get('samone-tn'), 'Falesia Samone')
})

test('no places, no lines', async () => {
  const db = await italy()
  assert.equal((await crumbLines(db, FALESIA, [])).size, 0)
})
