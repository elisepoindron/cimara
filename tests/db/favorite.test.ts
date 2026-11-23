import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import {
  addFavorite, removeFavorite, isFavorite, favoriteIdsOf, favoriteRowsOf,
} from '../../src/db/favorite.ts'
import type { Db } from '../../src/db/open.ts'

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000, facts: {}, sections: {},
    created: '2026-09-01T00:00:00.000Z',
  })
  await insertItinerary(db, {
    id: 'i2', activity: 'alpinismo', placeId: 'p1', name: 'Seconda',
    lat: 44.7, lon: 7.2, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 2500, facts: {}, sections: {},
    created: '2026-09-01T00:00:00.000Z',
  })
}

test('adding a favorite makes it findable, one way or the other', async () => {
  const db = await freshDb(); await scene(db)

  assert.equal(await isFavorite(db, 'a1', 'i1'), false)
  await addFavorite(db, 'a1', 'i1', '2026-09-15T10:00:00.000Z')
  assert.equal(await isFavorite(db, 'a1', 'i1'), true)
})

test('favoriting twice writes one row and is not an error', async () => {
  const db = await freshDb(); await scene(db)

  await addFavorite(db, 'a1', 'i1', '2026-09-15T10:00:00.000Z')
  await addFavorite(db, 'a1', 'i1', '2026-09-16T10:00:00.000Z')

  const rows = await db.all('select * from favorite where account_id = ? and itinerary_id = ?', ['a1', 'i1'])
  assert.equal(rows.length, 1)
})

test('unfavoriting deletes the row outright — no append-only shape here', async () => {
  const db = await freshDb(); await scene(db)

  await addFavorite(db, 'a1', 'i1', '2026-09-15T10:00:00.000Z')
  await removeFavorite(db, 'a1', 'i1')

  assert.equal(await isFavorite(db, 'a1', 'i1'), false)
  assert.equal((await db.all('select * from favorite')).length, 0)
})

test('unfavoriting something never favorited is not an error', async () => {
  const db = await freshDb(); await scene(db)
  await removeFavorite(db, 'a1', 'i1')
  assert.equal(await isFavorite(db, 'a1', 'i1'), false)
})

test('favoriteIdsOf batches the question for a whole page of rows', async () => {
  const db = await freshDb(); await scene(db)
  await addFavorite(db, 'a1', 'i1', '2026-09-15T10:00:00.000Z')

  const ids = await favoriteIdsOf(db, 'a1', ['i1', 'i2'])
  assert.deepEqual([...ids], ['i1'])
})

test('favoriteIdsOf on an empty list asks no question and returns none', async () => {
  const db = await freshDb(); await scene(db)
  assert.deepEqual([...await favoriteIdsOf(db, 'a1', [])], [])
})

test('favoriteRowsOf comes back most recently favorited first', async () => {
  const db = await freshDb(); await scene(db)
  await addFavorite(db, 'a1', 'i1', '2026-09-10T10:00:00.000Z')
  await addFavorite(db, 'a1', 'i2', '2026-09-15T10:00:00.000Z')

  const rows = await favoriteRowsOf(db, 'a1')
  assert.deepEqual(rows.map(r => r.id), ['i2', 'i1'])
  assert.equal(rows[0]!.name, 'Seconda')
  assert.equal(rows[0]!.placeName, 'Piemonte')
})

test('two accounts keep separate lists', async () => {
  const db = await freshDb(); await scene(db)
  await insertAccount(db, { id: 'a2', email: 'f@example.it', passwordHash: 'h', displayName: 'ste' })
  await addFavorite(db, 'a1', 'i1', '2026-09-15T10:00:00.000Z')

  assert.equal((await favoriteRowsOf(db, 'a2')).length, 0)
  assert.equal(await isFavorite(db, 'a2', 'i1'), false)
})
