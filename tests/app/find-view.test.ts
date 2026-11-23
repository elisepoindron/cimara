import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { find, SHOWN, SHORTLIST } from '../../src/app/find.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import type { Db } from '../../src/db/open.ts'

const NOW = new Date('2026-09-15T12:00:00.000Z')

/**
 * Ninety walks along a line of longitude, 7.00 to 7.89, so a view is a range of
 * them and the archive is deeper than the shortlist: three pages are ranked,
 * the rest follow in the search's own order.
 */
async function walks(db: Db) {
  await insertPlace(db, { id: 'reg', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertPlace(db, { id: 'prov', name: 'TO', kind: 'provincia', parentId: 'reg' })
  await insertPlace(db, { id: 'com', name: 'Balme', kind: 'comune', parentId: 'prov' })
  for (let i = 0; i < 90; i++) {
    await insertItinerary(db, {
      id: `w${String(i).padStart(2, '0')}`, activity: 'escursionismo', placeId: 'com', name: `Sentiero ${i}`,
      lat: 45.3, lon: 7 + i / 100, parkingLat: null, parkingLon: null, aspect: null, altMax: null,
      facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
  }
}
const ids = (r: { rows: readonly { ranked: { candidate: { id: string } } }[] }) => r.rows.map(x => x.ranked.candidate.id)

test('a view narrows the list to the routes inside it, and says how many are left out', async () => {
  const db = await freshDb(); await walks(db)
  const view = { minLon: 7.095, maxLon: 7.195, minLat: 45, maxLat: 46 }
  const r = await find(db, 'escursionismo', NOW, undefined, null, null, { view })

  assert.equal(r.total, 10, 'walks 10 to 19')
  assert.equal(r.totalAll, 90)
  assert.ok(r.rows.every(x => x.ranked.candidate.lon! >= 7.095 && x.ranked.candidate.lon! <= 7.195))
  assert.equal(r.points.length, 90, 'the map still has every match')
})

test('without a view the list is the whole answer, as it always was', async () => {
  const db = await freshDb(); await walks(db)
  const r = await find(db, 'escursionismo', NOW)
  assert.equal(r.total, 90)
  assert.equal(r.totalAll, null)
  assert.equal(r.page, 1)
  assert.equal(r.pages, Math.ceil(90 / SHOWN))
  assert.equal(r.rows.length, SHOWN)
})

test('the pages are one sequence: every route once, past the shortlist too', async () => {
  const db = await freshDb(); await walks(db)
  const seen: string[] = []
  for (let page = 1; page <= 5; page++) {
    const r = await find(db, 'escursionismo', NOW, undefined, null, null, { page })
    assert.equal(r.page, page)
    seen.push(...ids(r))
  }
  assert.ok(seen.length > SHORTLIST, 'the walk went past the ranked head')
  assert.equal(seen.length, 90)
  assert.equal(new Set(seen).size, 90, 'no route on two pages')
})

test('a page past the last is the last', async () => {
  const db = await freshDb(); await walks(db)
  const r = await find(db, 'escursionismo', NOW, undefined, null, null, { page: 99 })
  assert.equal(r.page, 5)
  assert.equal(r.rows.length, 10)
})

test('an empty view is an empty list, not a reread question', async () => {
  const db = await freshDb(); await walks(db)
  const r = await find(db, 'escursionismo', NOW, undefined, null, null, {
    view: { minLon: 9, maxLon: 9.5, minLat: 45, maxLat: 46 },
  })
  assert.equal(r.total, 0)
  assert.equal(r.rows.length, 0)
  assert.equal(r.reading.rewritten, null)
  assert.equal(r.totalAll, 90)
})
