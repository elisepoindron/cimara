import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../helpers/db.ts'
import { seed } from '../../src/seed/seed.ts'
import { readExtract } from '../../src/import/osm/source.ts'
import { importOsm, osmVocabulary } from '../../src/import/osm/run.ts'
import { osmReportOf } from '../../src/import/osm/report.ts'
import { allItineraries } from '../../src/db/itinerary.ts'
import { trackFor } from '../../src/db/track.ts'
import type { Db } from '../../src/db/open.ts'
import { NEVER_NAMED } from '../../src/import/osm/never-named.ts'

const FIXTURES = fileURLToPath(new URL('../fixtures/osm/', import.meta.url))
const EXTRACT = FIXTURES + 'extract'
const GAZETTEER = FIXTURES + 'gazetteer/places.json'
const CREATED = '2026-11-19T00:00:00.000Z'

async function demoDb(): Promise<Db> {
  const db = await freshDb()
  await seed(db, FIXTURES + 'gazetteer')
  return db
}

async function run(db: Db) {
  const { rows } = await readExtract(EXTRACT)
  return importOsm(db, rows, await osmVocabulary(db, GAZETTEER, CREATED))
}

test('the extract is read whole, with each feature\'s comune and terrain beside it', async () => {
  const { rows, osmBase } = await readExtract(EXTRACT)
  assert.equal(rows.length, 18 + 3 + 4 + 2 + 1 + 2)
  assert.equal(osmBase.climbing, '2026-11-19T17:28:18Z')
  const crag = rows.find(r => r.osm === 'w1')!
  assert.deepEqual(crag.comune, { name: 'Arnad', istat: '007004' })
  assert.equal(crag.terrain?.ele, 1189)
  assert.equal(rows.find(r => r.osm === 'n7')!.comune, null)
  assert.equal(rows.find(r => r.osm === 'n20')!.onMarkedPath, true)
  assert.equal(rows.find(r => r.osm === 'n21')!.onMarkedPath, false)
  assert.equal(rows.find(r => r.osm === 'r30')!.track?.length, 3)
})

test('only the comuni of Piemonte and Valle d\'Aosta that the database holds are known', async () => {
  const known = await osmVocabulary(await demoDb(), GAZETTEER, CREATED)
  assert.deepEqual(Object.keys(known.comuneByIstat).sort(), ['001001', '007004', '007023'])
  assert.equal(known.comuneByName['Albaredo per San Marco'], undefined)
})

test('complete places are written, crags wait for their vie, the rest is refused by name', async () => {
  const db = await demoDb()
  const result = await run(db)

  assert.deepEqual(result.written.map(p => p.osm).sort(), ['n16', 'n20', 'n9', 'r13', 'r30', 'r31', 'r50', 'r60', 'r61', 'w14', 'w40'])
  assert.deepEqual(result.waiting.map(p => [p.osm, p.needs]), [['w1', ['vie']], ['n6', ['esposizione', 'vie']]])
  assert.deepEqual(result.skipped.map(s => [s.osm, s.heldAs]), [['w41', 'w40']])
  assert.deepEqual(result.refused.map(r => [r.osm, r.field]), [
    ['n2', 'leisure'], ['n3', 'climbing:ice'], ['n4', 'climbing'], ['n5', 'name'], ['n7', 'comune'], ['n8', 'name'],
    ['n10', 'climbing:pitches'], ['n12', 'climbing'], ['r17', 'name'],
    ['r32', 'name'], ['r33', 'geometry'], ['n21', 'natural'], ['n22', 'ele'], ['n18', 'area'],
  ])
  assert.equal(result.places.length, 13)
  assert.deepEqual(result.grouped.map(g => [g.osm, g.area]), [['n11', 'r13'], ['n15', 'w14']])
  const area = result.places.find(p => p.osm === 'r13')!
  assert.deepEqual(area.boulders?.map(b => b.name), ['Blocchi di Prova'])
  assert.deepEqual(result.places.find(p => p.osm === 'w14')!.boulders?.[0]?.tags, { 'climbing:grade:font:max': '6c', 'climbing:routes': '3' })

  const held = await allItineraries(db)
  assert.deepEqual(held.map(i => [i.name, i.activity]), [
    ['Anello di Prova', 'escursionismo'], ['Area Blocchi di Prova', 'bouldering'], ['Becca di Prova', 'escursionismo'],
    ['Ferrata di Prova', 'via_ferrata'], ['Giro di Prova in MTB', 'mountain_bike'], ['Gita di Prova', 'sci_alpinismo'],
    ['Percorso MTB 12', 'mountain_bike'], ['Pietra di Prova', 'bouldering'], ['Sentiero 7A', 'escursionismo'],
    ['Settore Blocchi', 'bouldering'], ['Via Lunga di Prova', 'multipitch'],
  ])
  assert.ok(held.every(i => Object.keys(i.sections).length === 0), 'no prose is invented')
  const anello = held.find(i => i.name === 'Anello di Prova')!
  assert.deepEqual(anello.facts, { difficolta: 'E' })
  const track = await trackFor(db, anello.id)
  assert.equal(track?.points.length, 3)
  assert.equal(track?.source, 'osm:r30')

  const via = held.find(i => i.name === 'Via Lunga di Prova')!
  assert.deepEqual(via.facts, { quota_base: 1210, esposizione: 'S', grado_max: '6a+', sviluppo: 200, tiri: 6, protezione: 'spittata' })
  const ride = held.find(i => i.name === 'Giro di Prova in MTB')!
  assert.equal((await trackFor(db, ride.id))?.source, 'osm:r60', 'a ride keeps its line, as a hike does')
})

test('a second run writes nothing and still hands Phase 3 every place', async () => {
  const db = await demoDb()
  await run(db)
  const again = await run(db)
  assert.equal(again.written.length, 0)
  assert.equal(again.places.length, 13)
  assert.equal((await allItineraries(db)).length, 11)
})

test('the report counts by activity and reason, and never names the site', async () => {
  const text = osmReportOf(await run(await demoDb()))
  assert.match(text, /13 places taken: 11 written, 2 waiting/)
  assert.match(text, /falesia: 0 \/ 2/)
  assert.match(text, /vie: 2/)
  assert.match(text, /1 × leisure: a climbing gym/)
  assert.match(text, /n8 \(found: \(withheld\)\)/)
  assert.match(text, /Boulders listed under the area OpenStreetMap puts them in: 2, in 2 areas/)
  assert.doesNotMatch(text, NEVER_NAMED)
})
