import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { byId, partsOf, allItineraries, insertItinerary } from '../../src/db/itinerary.ts'
import { ancestorsOf } from '../../src/db/place.ts'
import type { Db } from '../../src/db/open.ts'

/** Piemonte / CN / Crissolo. Returns the comune's id. */
async function crissolo(db: Db): Promise<string> {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [ids[0]!])
  await db.run(`insert into place (id, name, kind, parent_id) values (?, 'CN', 'provincia', ?)`,
               [ids[1]!, ids[0]!])
  await db.run(`insert into place (id, name, kind, parent_id) values (?, 'Crissolo', 'comune', ?)`,
               [ids[2]!, ids[1]!])
  return ids[2]!
}

test('an itinerary round-trips with its promoted columns and its facts bag', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  const id = crypto.randomUUID()

  await db.run(`
    insert into itinerary (id, activity, place_id, name, lat, lon, aspect, alt_max,
                           facts, sections, created)
    values (?, 'alpinismo', ?, 'Monviso, Cresta Est', 44.6673, 7.0913, 'SE', 3841, ?, ?, ?)`,
    [id, place,
     '{"difficolta":"AD","dislivello":2000,"partenza":2020,"vetta":3841,"esposizione":"SE","giorni":2}',
     '{"note":"Invented.","descrizione":"Invented."}',
     new Date().toISOString()])

  const it = await byId(db, id)
  assert.equal(it?.name, 'Monviso, Cresta Est')
  assert.equal(it?.activity, 'alpinismo')
  assert.equal(it?.aspect, 'SE')
  assert.equal(it?.altMax, 3841)
  assert.equal(it?.lat, 44.6673)
  assert.equal(it?.facts.difficolta, 'AD', 'facts arrive parsed, not as a string')
  assert.equal(it?.sections.note, 'Invented.')
})

test('an itinerary carries its own parking coordinates, distinct from its own lat/lon', async () => {
  const db = await freshDb()
  const place = await crissolo(db)

  await insertItinerary(db, {
    id: 'monviso', activity: 'alpinismo', placeId: place, name: 'Monviso, Cresta Est',
    lat: 44.6673, lon: 7.0913, aspect: 'SE', altMax: 3841,
    parkingLat: 44.69938, parkingLon: 7.15609,
    facts: {}, sections: {}, created: new Date().toISOString(),
  })

  const it = await byId(db, 'monviso')
  assert.equal(it?.parkingLat, 44.69938)
  assert.equal(it?.parkingLon, 7.15609)
  assert.equal(it?.lat, 44.6673, "the route's own point is untouched by the parking point")
})

test('parking coordinates default to null, like the itinerary already does for lat/lon', async () => {
  const db = await freshDb()
  const place = await crissolo(db)

  await insertItinerary(db, {
    id: 'senza-parcheggio', activity: 'alpinismo', placeId: place, name: 'Senza parcheggio noto',
    lat: null, lon: null, aspect: null, altMax: null, parkingLat: null, parkingLon: null,
    facts: {}, sections: {}, created: new Date().toISOString(),
  })

  const it = await byId(db, 'senza-parcheggio')
  assert.equal(it?.parkingLat, null)
  assert.equal(it?.parkingLon, null)
})

test('byId returns null for an id that is not there', async () => {
  const db = await freshDb()
  assert.equal(await byId(db, crypto.randomUUID()), null)
})

test('parts come back in position order, carrying their optional sector', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  const crag = crypto.randomUUID()
  await db.run(`insert into itinerary (id, activity, place_id, name, aspect, alt_max, created)
                values (?, 'falesia', ?, 'Balma Scura', 'S', 780, ?)`,
               [crag, place, new Date().toISOString()])

  await db.run(`insert into part (id, itinerary_id, group_name, position, fields)
                values (?, ?, 'Scuola', 2, '{"nome":"Seconda","grado":"6b","lunghezza":18}')`,
               [crypto.randomUUID(), crag])
  await db.run(`insert into part (id, itinerary_id, group_name, position, fields)
                values (?, ?, 'Basso', 1, '{"nome":"Prima","grado":"6a","lunghezza":14}')`,
               [crypto.randomUUID(), crag])

  const parts = await partsOf(db, crag)
  assert.deepEqual(parts.map(p => p.position), [1, 2])
  assert.deepEqual(parts.map(p => p.group), ['Basso', 'Scuola'])
  assert.equal(parts[0]?.fields.grado, '6a')
})

test('a crag with no sectors has parts whose group is null', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  const crag = crypto.randomUUID()
  await db.run(`insert into itinerary (id, activity, place_id, name, created)
                values (?, 'falesia', ?, 'Senza settori', ?)`,
               [crag, place, new Date().toISOString()])
  await db.run(`insert into part (id, itinerary_id, position, fields)
                values (?, ?, 1, '{"nome":"Unica","grado":"5c","lunghezza":12}')`,
               [crypto.randomUUID(), crag])
  assert.equal((await partsOf(db, crag))[0]?.group, null)
})

test('the breadcrumb comes back root first', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  assert.deepEqual((await ancestorsOf(db, place)).map(p => p.name), ['Piemonte', 'CN', 'Crissolo'])
})

test('a cycle in the parent chain terminates instead of hanging the process', async () => {
  const db = await freshDb()
  const a = crypto.randomUUID()
  const b = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'A', 'regione')`, [a])
  await db.run(`insert into place (id, name, kind, parent_id) values (?, 'B', 'provincia', ?)`,
               [b, a])
  // Neither insert is a self-parent, so the check constraint lets this two-node
  // cycle through; only the recursive query's depth bound can stop it.
  await db.run(`update place set parent_id = ? where id = ?`, [b, a])

  const chain = await ancestorsOf(db, a)
  assert.ok(chain.length <= 17, 'the recursive arm stops at its depth bound rather than looping forever')
})

test('a place cannot be its own parent', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  await assert.rejects(
    db.run(`update place set parent_id = id where id = ?`, [place]),
    /CHECK constraint failed/)
})

test('a strict table refuses a value of the wrong type', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  await assert.rejects(
    db.run(`insert into itinerary (id, activity, place_id, name, alt_max, created)
            values (?, 'alpinismo', ?, 'Sbagliata', 'molto alta', ?)`,
           [crypto.randomUUID(), place, new Date().toISOString()]),
    /alt_max/)
})

test('facts and sections must be a JSON object, not a bare scalar', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  await assert.rejects(
    db.run(`insert into itinerary (id, activity, place_id, name, facts, created)
            values (?, 'alpinismo', ?, 'Bagno di numeri', '5', ?)`,
           [crypto.randomUUID(), place, new Date().toISOString()]),
    /CHECK constraint failed/, 'facts = 5 is valid JSON but not a bag')
  await assert.rejects(
    db.run(`insert into itinerary (id, activity, place_id, name, sections, created)
            values (?, 'alpinismo', ?, 'Bagno di stringhe', '"nope"', ?)`,
           [crypto.randomUUID(), place, new Date().toISOString()]),
    /CHECK constraint failed/, 'sections = "nope" is valid JSON but not a bag')
})

test("a part's fields must be a JSON object, not a bare scalar", async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  const crag = crypto.randomUUID()
  await db.run(`insert into itinerary (id, activity, place_id, name, created)
                values (?, 'falesia', ?, 'Balma Scura', ?)`,
               [crag, place, new Date().toISOString()])
  await assert.rejects(
    db.run(`insert into part (id, itinerary_id, position, fields)
            values (?, ?, 1, '5')`,
           [crypto.randomUUID(), crag]),
    /CHECK constraint failed/)
})

test('allItineraries returns every row, for the startup check to walk', async () => {
  const db = await freshDb()
  const place = await crissolo(db)
  for (const name of ['Uno', 'Due']) {
    await db.run(`insert into itinerary (id, activity, place_id, name, created)
                  values (?, 'alpinismo', ?, ?, ?)`,
                 [crypto.randomUUID(), place, name, new Date().toISOString()])
  }
  assert.equal((await allItineraries(db)).length, 2)
})
