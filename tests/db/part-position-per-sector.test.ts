import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { partsOf } from '../../src/db/itinerary.ts'

async function crag() {
  const db = await freshDb()
  await db.run(`insert into place (id, name, kind) values ('p', 'Prova', 'regione')`)
  await db.run(`insert into itinerary (id, activity, place_id, name, created)
                values ('c', 'falesia', 'p', 'Due settori', '2026-09-01T00:00:00.000Z')`)
  const via = (id: string, group: string | null, position: number) => db.run(
    `insert into part (id, itinerary_id, group_name, position, fields) values (?, 'c', ?, ?, '{}')`,
    [id, group, position])
  return { db, via }
}

test('two sectors may each have a via 1, as their topo numbers them', async () => {
  const { db, via } = await crag()
  await via('a1', null, 1)
  await via('a2', null, 2)
  await via('t1', 'Take Away', 1)
  await via('t2', 'Take Away', 2)

  const parts = await partsOf(db, 'c')
  assert.deepEqual(parts.map(p => p.id), ['a1', 't1', 'a2', 't2'],
    'by number, and in the order they were listed where numbers tie')
})

test('two vie numbered alike in one sector are still refused', async () => {
  const { via } = await crag()
  await via('t1', 'Take Away', 1)
  await assert.rejects(via('t1bis', 'Take Away', 1), /UNIQUE/)
})

test('two ungrouped vie numbered alike are still refused: no sector is one sector', async () => {
  const { via } = await crag()
  await via('a3', null, 3)
  await assert.rejects(via('a3bis', null, 3), /UNIQUE/)
})
