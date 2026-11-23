import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary, setGradeBounds } from '../../src/db/itinerary.ts'
import { isFavorite } from '../../src/db/favorite.ts'
import { listFavorites, addFavorite, removeFavorite } from '../../src/app/favorites.ts'
import { gradeScale } from '../../src/domain/quantity.ts'
import type { Db } from '../../src/db/open.ts'

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'reg', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertPlace(db, { id: 'prov', name: 'CN', kind: 'provincia', parentId: 'reg' })
  await insertPlace(db, { id: 'com', name: 'Crissolo', kind: 'comune', parentId: 'prov' })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'com', name: 'Monviso, Cresta Est',
    lat: 44.6673, lon: 7.0913, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3841,
    facts: { difficolta: 'AD', dislivello: 2000, partenza: 2020, vetta: 3841,
             esposizione: 'SE', giorni: 2 },
    sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
  const ad = gradeScale('alpine').ordinal('AD')
  await setGradeBounds(db, 'i1', { min: ad, max: ad })
}

test('addFavorite writes a row an account can later see listed', async () => {
  const db = await freshDb(); await scene(db)

  await addFavorite(db, 'a1', 'i1', new Date('2026-09-15T10:00:00.000Z'))

  const rows = await listFavorites(db, 'a1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.id, 'i1')
  assert.equal(rows[0]!.name, 'Monviso, Cresta Est')
})

test('a listed row carries where it is and its facts, same as a Find row would', async () => {
  const db = await freshDb(); await scene(db)
  await addFavorite(db, 'a1', 'i1', new Date('2026-09-15T10:00:00.000Z'))

  const [row] = await listFavorites(db, 'a1')
  assert.equal(row!.where, 'CN Crissolo')
  assert.deepEqual(row!.cells.map(c => (c?.kind === 'fact' ? c.text : c)), ['AD', '2000 m', 'Sud-Est', null],
    'Preferiti names no place, so there is no distance')
})

test('removeFavorite takes it back off the list', async () => {
  const db = await freshDb(); await scene(db)
  await addFavorite(db, 'a1', 'i1', new Date('2026-09-15T10:00:00.000Z'))

  await removeFavorite(db, 'a1', 'i1')

  assert.equal((await listFavorites(db, 'a1')).length, 0)
  assert.equal(await isFavorite(db, 'a1', 'i1'), false)
})

test('an account with nothing favorited gets an empty list, not an error', async () => {
  const db = await freshDb(); await scene(db)
  assert.deepEqual(await listFavorites(db, 'a1'), [])
})
