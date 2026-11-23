import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPendingPhoto, livePendingPhotos } from '../../src/db/pending-photo.ts'
import { uploadPendingPhotos, sweepExpiredPendingPhotos, PHOTOS_MAX } from '../../src/app/gite.ts'
import type { UploadedFile } from '../../src/app/http.ts'
import type { Db } from '../../src/db/open.ts'

const NOW = new Date('2026-09-11T12:00:00.000Z')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const NOT_A_PHOTO = Buffer.from('questo non è un JPEG')

const photoFile = (filename: string, bytes: Buffer, contentType = 'image/jpeg'): UploadedFile =>
  ({ field: 'foto', filename, contentType, bytes })

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
}

test('two valid photos upload, and come back live under a1', async () => {
  const db = await freshDb(); await scene(db)
  const store = memoryPhotoStore()
  const r = await uploadPendingPhotos(db, store, 'a1', [
    photoFile('a.jpg', JPEG), photoFile('b.png', PNG, 'image/png'),
  ], NOW)

  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.ids.length, 2)
  const live = await livePendingPhotos(db, 'a1', r.ids, NOW.toISOString())
  assert.equal(live.length, 2)
})

test('an uploaded photo\'s bytes are readable back from the pending store', async () => {
  const db = await freshDb(); await scene(db)
  const store = memoryPhotoStore()
  const r = await uploadPendingPhotos(db, store, 'a1', [photoFile('a.jpg', JPEG)], NOW)

  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(await store.get(r.ids[0]!, 'image/jpeg'), JPEG)
})

test('an uploaded photo expires 24 hours after it was uploaded', async () => {
  const db = await freshDb(); await scene(db)
  const r = await uploadPendingPhotos(db, memoryPhotoStore(), 'a1', [photoFile('a.jpg', JPEG)], NOW)

  assert.equal(r.ok, true)
  if (!r.ok) return
  const stillLive = await livePendingPhotos(db, 'a1', r.ids, '2026-09-12T11:59:59.000Z')
  const expired = await livePendingPhotos(db, 'a1', r.ids, '2026-09-12T12:00:01.000Z')
  assert.equal(stillLive.length, 1)
  assert.equal(expired.length, 0)
})

test('bytes that are not really a JPEG or PNG are refused by position in the batch', async () => {
  const db = await freshDb(); await scene(db)
  const r = await uploadPendingPhotos(db, memoryPhotoStore(), 'a1', [
    photoFile('a.jpg', JPEG), photoFile('b.jpg', NOT_A_PHOTO),
  ], NOW)

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 2/)
})

test('one bad file among several refuses the whole batch — nothing is written', async () => {
  const db = await freshDb(); await scene(db)
  const r = await uploadPendingPhotos(db, memoryPhotoStore(), 'a1', [
    photoFile('a.jpg', JPEG), photoFile('b.jpg', NOT_A_PHOTO),
  ], NOW)

  assert.equal(r.ok, false)
  assert.equal((await db.all('select id from pending_photo')).length, 0)
})

test('more than PHOTOS_MAX files in one batch is refused', async () => {
  const db = await freshDb(); await scene(db)
  const files = Array.from({ length: PHOTOS_MAX + 1 }, (_, i) => photoFile(`f${i}.jpg`, JPEG))
  const r = await uploadPendingPhotos(db, memoryPhotoStore(), 'a1', files, NOW)

  assert.equal(r.ok, false)
})

test('exactly PHOTOS_MAX files in one batch uploads', async () => {
  const db = await freshDb(); await scene(db)
  const files = Array.from({ length: PHOTOS_MAX }, (_, i) => photoFile(`f${i}.jpg`, JPEG))
  const r = await uploadPendingPhotos(db, memoryPhotoStore(), 'a1', files, NOW)

  assert.equal(r.ok, true)
})

test('sweeping deletes this account’s own expired rows and their files, leaves the rest', async () => {
  const db = await freshDb(); await scene(db)
  const store = memoryPhotoStore()
  await store.put('gone', 'image/jpeg', JPEG)
  await insertPendingPhoto(db, {
    id: 'gone', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-09T12:00:00.000Z', expires: '2026-09-10T12:00:00.000Z',
  })
  await store.put('still-good', 'image/jpeg', JPEG)
  await insertPendingPhoto(db, {
    id: 'still-good', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-12T12:00:00.000Z',
  })

  await sweepExpiredPendingPhotos(db, store, 'a1', NOW)

  assert.equal(await store.get('gone', 'image/jpeg'), null)
  assert.deepEqual(await store.get('still-good', 'image/jpeg'), JPEG)
  assert.deepEqual((await livePendingPhotos(db, 'a1', ['gone', 'still-good'], NOW.toISOString())).map(p => p.id),
    ['still-good'])
})
