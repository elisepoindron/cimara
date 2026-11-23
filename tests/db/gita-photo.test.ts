import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { fileGita, insertImportedReport, retractGita, type NewGita } from '../../src/db/gita.ts'
import {
  insertImportedPhotos, insertPhotos, photosFor, standingPhoto, type NewPhoto,
} from '../../src/db/gita-photo.ts'
import type { Db } from '../../src/db/open.ts'

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null,
    aspect: 'SE', altMax: 3000, facts: {}, sections: {},
    created: '2026-09-01T00:00:00.000Z',
  })
}

const G: NewGita = {
  id: 'g1', itineraryId: 'i1', accountId: 'a1',
  observedAt: '2026-09-05', filedAt: '2026-09-06T20:00:00.000Z',
  words: 'Neve dura sopra i 3200.',
}

const PHOTOS: NewPhoto[] = [
  { id: 'ph1', position: 0, caption: 'La parete est', mime: 'image/jpeg' },
  { id: 'ph2', position: 1, caption: null, mime: 'image/png' },
]

test('photos filed with a gita come back with its author and date', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)

  const photos = await photosFor(db, 'i1')
  assert.equal(photos.length, 2)
  assert.equal(photos[0]?.id, 'ph1')
  assert.equal(photos[0]?.caption, 'La parete est')
  assert.equal(photos[1]?.caption, null, 'no caption is null, not an empty string')
  assert.equal(photos[0]?.authorName, 'vale74')
  assert.equal(photos[0]?.observedAt, '2026-09-05')
})

test('photos come back with the gita they belong to', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)

  const photos = await photosFor(db, 'i1')
  assert.equal(photos[0]?.gitaId, 'g1')
})

test('photos come back ordered by their gita, newest first, then position', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)
  await fileGita(db, { ...G, id: 'g2', observedAt: '2026-09-08' })
  await insertPhotos(db, 'g2', [{ id: 'ph3', position: 0, caption: null, mime: 'image/jpeg' }])

  const ids = (await photosFor(db, 'i1')).map(p => p.id)
  assert.deepEqual(ids, ['ph3', 'ph1', 'ph2'], "g2 is newer, then g1's own two by position")
})

test("a retracted gita's photos disappear from the itinerary, the same as its report", async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)
  await retractGita(db, 'g1', '2026-09-07T08:00:00.000Z')

  assert.equal((await photosFor(db, 'i1')).length, 0)
})

test('nothing is deleted when a gita is retracted', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)
  await retractGita(db, 'g1', '2026-09-07T08:00:00.000Z')

  assert.equal((await db.all('select id from gita_photo')).length, 2,
    'conditions must stay recomputable from zero')
})

test('standingPhoto is true for a photo whose gita was never retracted', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)

  assert.equal(await standingPhoto(db, 'ph1'), true)
})

test('standingPhoto is false once the photo’s gita is retracted', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)
  await insertPhotos(db, 'g1', PHOTOS)
  await retractGita(db, 'g1', '2026-09-07T08:00:00.000Z')

  assert.equal(await standingPhoto(db, 'ph1'), false)
})

test('standingPhoto is false for an id nobody filed', async () => {
  const db = await freshDb(); await scene(db)

  assert.equal(await standingPhoto(db, 'non-esiste'), false)
})

test('two photos of the same gita cannot claim the same position', async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)

  await assert.rejects(insertPhotos(db, 'g1', [
    { id: 'x', position: 0, caption: null, mime: 'image/jpeg' },
    { id: 'y', position: 0, caption: null, mime: 'image/jpeg' },
  ]))
})

const CREDIT = {
  author: 'Mario Rossi', licence: 'CC BY 4.0', licenceUrl: null,
  source: 'https://commons.wikimedia.org/wiki/File:X.jpg',
}

test("an imported report's photos stand beside filed ones, in the reports' own order", async () => {
  const db = await freshDb(); await scene(db)
  await fileGita(db, G)                                   // 2026-09-05, filed the 6th
  await insertPhotos(db, 'g1', PHOTOS)
  await insertImportedReport(db, { id: 'ir1', itineraryId: 'i1', observedAt: '2026-09-07', words: 'Roccia asciutta.' })
  await insertImportedReport(db, { id: 'ir2', itineraryId: 'i1', observedAt: '2026-09-01', words: 'Vento.' })
  await insertImportedPhotos(db, 'ir1', [{ id: 'im1', position: 0, caption: null, mime: 'image/jpeg', credit: CREDIT }])
  await insertImportedPhotos(db, 'ir2', [
    { id: 'im3', position: 1, caption: null, mime: 'image/jpeg', credit: CREDIT },
    { id: 'im2', position: 0, caption: 'Il muro', mime: 'image/png', credit: CREDIT },
  ])

  const photos = await photosFor(db, 'i1')
  assert.deepEqual(photos.map(p => p.id), ['im1', 'ph1', 'ph2', 'im2', 'im3'])
  assert.equal(photos[0]?.gitaId, 'ir1')
  assert.equal(photos[0]?.authorName, null, 'nobody here filed an imported report')
  assert.deepEqual(photos[0]?.credit, CREDIT)
  assert.equal(photos[1]?.credit, null, 'a filed photo is credited by its gita')
  assert.equal(await standingPhoto(db, 'im2'), true)
})

test("an imported report's photo is refused without its author or its licence", async () => {
  const db = await freshDb(); await scene(db)
  await insertImportedReport(db, { id: 'ir1', itineraryId: 'i1', observedAt: '2026-09-07', words: 'Roccia asciutta.' })
  await assert.rejects(insertImportedPhotos(db, 'ir1', [
    { id: 'x', position: 0, caption: null, mime: 'image/jpeg', credit: { ...CREDIT, author: '' } }]))
  await assert.rejects(insertImportedPhotos(db, 'ir1', [
    { id: 'y', position: 0, caption: null, mime: 'image/jpeg', credit: { ...CREDIT, licence: '' } }]))
})
