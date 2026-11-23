import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary, byId, nearbyRoutes } from '../../src/db/itinerary.ts'
import { fileGita, insertImportedReport, retractGita } from '../../src/db/gita.ts'
import type { Db } from '../../src/db/open.ts'
import type { Aspect } from '../../src/domain/quantity.ts'

const M_PER_DEGREE_LON = 79_083
const OPTS = { withinM: 5000, sameAspect: true, altToleranceM: 400, since: '2026-11-02' }

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'v' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  const put = async (id: string, km: number, o: { aspect?: Aspect; activity?: string; altMax?: number } = {}) =>
    insertItinerary(db, {
      id, activity: o.activity ?? 'falesia', placeId: 'p1', name: id,
      lat: 45.06, lon: 7.15 + (km * 1000) / M_PER_DEGREE_LON,
      parkingLat: null, parkingLon: null,
      aspect: o.aspect ?? 'S', altMax: o.altMax ?? 780, facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
  await put('self', 0)
  await put('due', 2)
  await put('quattro', 4)
  await put('lontana', 9)
  await put('nord', 1, { aspect: 'N' })
  await put('alpina', 1, { activity: 'alpinismo' })
  await put('alta', 1, { altMax: 1500 })
}

const gita = (db: Db, id: string, on: string, it = 'due') => fileGita(db, {
  id, itineraryId: it, accountId: 'a1', observedAt: on, filedAt: `${on}T18:00:00.000Z`,
  words: 'x' })

test('nearby is the same activity and aspect, within the radius and the altitude, nearest first', async () => {
  const db = await freshDb()
  await scene(db)
  const near = await nearbyRoutes(db, (await byId(db, 'self'))!, OPTS)
  assert.deepEqual(near.map(n => n.id), ['due', 'quattro'])
})

test('a route nobody has reported is kept, with nothing to count', async () => {
  const db = await freshDb()
  await scene(db)
  const [due] = await nearbyRoutes(db, (await byId(db, 'self'))!, OPTS)
  assert.equal(due!.recent, 0)
  assert.equal(due!.lastReportAt, null)
})

test('filed and imported reports both count; recent only inside the window', async () => {
  const db = await freshDb()
  await scene(db)
  await gita(db, 'g1', '2026-11-15')
  await insertImportedReport(db, { id: 'i1', itineraryId: 'due', observedAt: '2026-11-10', words: 'y' })
  await insertImportedReport(db, { id: 'i2', itineraryId: 'due', observedAt: '2026-08-01', words: 'z' })
  const [due] = await nearbyRoutes(db, (await byId(db, 'self'))!, OPTS)
  assert.equal(due!.recent, 2)
  assert.equal(due!.lastReportAt, '2026-11-15')
})

test('a withdrawn gita is not a report', async () => {
  const db = await freshDb()
  await scene(db)
  await gita(db, 'g1', '2026-11-15')
  await retractGita(db, 'g1', '2026-11-16T08:00:00.000Z')
  const [due] = await nearbyRoutes(db, (await byId(db, 'self'))!, OPTS)
  assert.equal(due!.recent, 0)
  assert.equal(due!.lastReportAt, null)
})

test('the map’s neighbours are every route of the same activity in reach, whatever their aspect or altitude', async () => {
  const db = await freshDb()
  await scene(db)
  const around = await nearbyRoutes(db, (await byId(db, 'self'))!,
    { withinM: 12_000, sameAspect: false, altToleranceM: null, since: '2026-11-02' })
  assert.deepEqual(around.map(n => n.id).sort(), ['alta', 'due', 'lontana', 'nord', 'quattro'])
  const due = around.find(n => n.id === 'due')!
  assert.equal(due.lat, 45.06)
  assert.ok(Math.abs(due.lon - (7.15 + 2000 / M_PER_DEGREE_LON)) < 1e-9)
})
