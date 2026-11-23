import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'
import { fileFromForm, PHOTOS_MAX } from '../../src/app/gite.ts'
import { WORDS_MAX, CAPTION_MAX } from '../../src/render/gita-form.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import type { PhotoStore } from '../../src/app/photo-store.ts'
import { insertPendingPhoto } from '../../src/db/pending-photo.ts'
import type { Db } from '../../src/db/open.ts'

const NOW = new Date('2026-09-11T12:00:00.000Z')

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, { id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null,
    aspect: 'SE', altMax: 3000, facts: {}, sections: {},
    created: '2026-09-01T00:00:00.000Z' })
}

const fields = (over: Record<string, string> = {}) => new Map(Object.entries({
  quando: '2026-09-09',
  parole: 'Neve dura sopra i 3200.', ...over,
}))

const fileNoPhotos = (db: Db, over: Record<string, string> = {}) =>
  fileFromForm(db, memoryPhotoStore(), memoryPhotoStore(), { itineraryId: 'i1', accountId: 'a1', fields: fields(over) }, NOW)

test('a good submission files a gita', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db)

  assert.equal(r.ok, true)
  const gite = await giteFor(db, 'i1')
  assert.equal(gite[0]?.words, 'Neve dura sopra i 3200.')
})

test('a verdict or a measure an old form still posts is ignored, not stored and not refused', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db, { verdetto: 'benissimo', limite_neve: 'tremila' })

  assert.equal(r.ok, true, 'nothing reads those fields any more, so nothing can be wrong with them')
  assert.equal((await giteFor(db, 'i1')).length, 1)
})

test('you cannot report a climb you have not done yet', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db, { quando: '2026-09-20' })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /futuro/i)
})

test('a gita with no words is refused', async () => {
  const db = await freshDb(); await scene(db)
  assert.equal((await fileNoPhotos(db, { parole: '   ' })).ok, false)
})

test('every problem is reported at once', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db, { quando: '2026-09-20', parole: '' })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.problems.length, 2, 'one attempt, every problem — as resolveFacts does')
})

test('nothing is written when validation fails', async () => {
  const db = await freshDb(); await scene(db)
  await fileNoPhotos(db, { parole: '' })

  assert.equal((await giteFor(db, 'i1')).length, 0)
})

// Ruling D: maxlength is a courtesy to an honest browser. This is the control.
test('a report of exactly WORDS_MAX characters files, and one more is refused', async () => {
  const db = await freshDb(); await scene(db)

  const atTheCap = await fileNoPhotos(db, { parole: 'a'.repeat(WORDS_MAX) })
  assert.equal(atTheCap.ok, true, 'the cap itself is allowed')

  const overIt = await fileNoPhotos(db, { parole: 'a'.repeat(WORDS_MAX + 1) })
  assert.equal(overIt.ok, false)
  assert.equal((await giteFor(db, 'i1')).length, 1, 'only the one that fitted was written')
})

test('today is not the future — a gita filed on the day it happened', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db, { quando: NOW.toISOString().slice(0, 10) })

  assert.equal(r.ok, true, 'whole days, not instants: noon today is not after today')
})

test('a day that is not a date at all is refused, rather than stored', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileNoPhotos(db, { quando: 'ieri' })

  assert.equal(r.ok, false)
  assert.equal((await giteFor(db, 'i1')).length, 0)
})

test('filing against an itinerary that does not exist writes nothing', async () => {
  const db = await freshDb(); await scene(db)
  const r = await fileFromForm(db, memoryPhotoStore(), memoryPhotoStore(),
    { itineraryId: 'non-esiste', accountId: 'a1', fields: fields() }, NOW)

  assert.equal(r.ok, false)
  assert.equal((await db.all('select id from gita')).length, 0)
})

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

/** Seeds one pending photo for a1 and returns its id — every photo test
 * builds its `foto_ids`/`incl_<id>` fields from ids this returns. */
async function pending(
  db: Db, store: PhotoStore,
  over: { id?: string; accountId?: string; mime?: 'image/jpeg' | 'image/png'; bytes?: Buffer; expires?: string } = {},
): Promise<string> {
  const id = over.id ?? crypto.randomUUID()
  const mime = over.mime ?? 'image/jpeg'
  await store.put(id, mime, over.bytes ?? JPEG)
  await insertPendingPhoto(db, {
    id, accountId: over.accountId ?? 'a1', mime,
    created: '2026-09-10T12:00:00.000Z', expires: over.expires ?? '2026-09-12T12:00:00.000Z',
  })
  return id
}

/** The one shape every photo test files under — two *distinct* stores,
 * per the plan's own Global Constraints: `photos` and `pendingPhotos` are
 * never the same instance. */
const file = (
  db: Db, photos: PhotoStore, pendingPhotos: PhotoStore, over: Record<string, string> = {},
) => fileFromForm(db, photos, pendingPhotos, { itineraryId: 'i1', accountId: 'a1', fields: fields(over) }, NOW)

test('a gita with two included photos files them, positioned in foto_ids order', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)
  const p2 = await pending(db, pendingPhotos, { mime: 'image/png', bytes: PNG })

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on', [`incl_${p2}`]: 'on',
  })

  assert.equal(r.ok, true)
  const rows = await db.all<{ position: number; mime: string }>(
    'select position, mime from gita_photo order by position')
  assert.deepEqual(rows.map(r => ({ position: r.position, mime: r.mime })),
    [{ position: 0, mime: 'image/jpeg' }, { position: 1, mime: 'image/png' }])
})

test('all six photos, all included, files six photos positioned 0 through 5', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const ids = await Promise.all(Array.from({ length: 6 }, () => pending(db, pendingPhotos)))

  const over: Record<string, string> = { foto_ids: ids.join(',') }
  for (const id of ids) over[`incl_${id}`] = 'on'
  const r = await file(db, photos, pendingPhotos, over)

  assert.equal(r.ok, true)
  const rows = await db.all<{ position: number }>('select position from gita_photo order by position')
  assert.deepEqual(rows.map(r => r.position), [0, 1, 2, 3, 4, 5])
})

test('more than PHOTOS_MAX included ids is refused, not a crash off the row-level CHECK', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const ids = await Promise.all(Array.from({ length: PHOTOS_MAX + 1 }, () => pending(db, pendingPhotos)))

  const over: Record<string, string> = { foto_ids: ids.join(',') }
  for (const id of ids) over[`incl_${id}`] = 'on'
  const r = await file(db, photos, pendingPhotos, over)

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), new RegExp(String(PHOTOS_MAX)))
  assert.equal((await db.all('select id from gita_photo')).length, 0)
})

test('the same id repeated in foto_ids is refused, not promoted twice off one live row', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)

  const r = await file(db, photos, pendingPhotos, { foto_ids: `${p1},${p1}`, [`incl_${p1}`]: 'on' })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 2/)
  assert.equal((await db.all('select id from gita_photo')).length, 0)
})

test('if a pending photo\'s bytes are already gone by promotion time, the whole publish is refused, not crashed', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore()
  const p1 = crypto.randomUUID()
  await insertPendingPhoto(db, {
    id: p1, accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-12T12:00:00.000Z',
  })
  // The database still says this id is live — `livePendingPhotos` will find
  // it — but its bytes are already gone from the store, simulating the
  // vanishingly rare race the null-bytes guard exists for without needing
  // two real concurrent requests.
  const vanished: PhotoStore = { async put() {}, async get() { return null }, async remove() {} }

  const r = await file(db, photos, vanished, { foto_ids: p1, [`incl_${p1}`]: 'on' })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 1/)
})

/**
 * The promotion loop is sequential, not concurrent, so a null read for the
 * *second* of several photos in one batch is fully deterministic to build —
 * no timing-dependent two-request race needed. `photos` here is destroyed
 * (`get` always answers null) for `p2` only. If bytes were still moved one
 * photo at a time as they were read, `p1` would already be promoted —
 * removed from `pendingPhotos` and written into `photos` — by the moment
 * `p2`'s read comes back null and the whole publish is refused: a photo the
 * climber can never recover under its old id, nor publish, until it expires
 * on its own. Reading every photo's bytes before moving any of them is what
 * this test holds the code to.
 */
test('a null read partway through several photos refuses the whole publish before any of them move', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore()
  const backing = memoryPhotoStore()
  const p1 = await pending(db, backing)
  const p2 = await pending(db, backing)

  const removed: string[] = []
  const flaky: PhotoStore = {
    async put(id, mime, bytes) { await backing.put(id, mime, bytes) },
    async get(id, mime) { return id === p2 ? null : backing.get(id, mime) },
    async remove(id, mime) { removed.push(id); await backing.remove(id, mime) },
  }

  const r = await file(db, photos, flaky, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on', [`incl_${p2}`]: 'on',
  })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 2/)
  assert.match(r.problems.join(' '), /scaduta/)

  assert.equal((await db.all('select id from gita_photo')).length, 0, 'nothing was ever filed')
  assert.equal(removed.length, 0,
    'p1’s pending row must survive — the batch was refused, so nothing in it may move')
  assert.equal(await photos.get(p1, 'image/jpeg'), null,
    'p1’s bytes must not have moved to the real store either')
})

test('an unchecked photo is left out of what gets promoted — not an error', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)
  const p2 = await pending(db, pendingPhotos)

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on',
    // incl_<p2> deliberately absent — the box was unchecked
  })

  assert.equal(r.ok, true)
  assert.equal((await db.all('select id from gita_photo')).length, 1)
})

test('an expired id is refused by number, naming the position it was picked in', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)
  const p2 = await pending(db, pendingPhotos, { expires: '2026-09-01T00:00:00.000Z' })

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on', [`incl_${p2}`]: 'on',
  })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 2/)
  assert.match(r.problems.join(' '), /scaduta/)
})

test('an unchecked but expired photo is not a reason to refuse a publish that never wanted it', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)
  const p2 = await pending(db, pendingPhotos, { expires: '2026-09-01T00:00:00.000Z' })

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on',
    // p2 unchecked — its own expiry must never be looked up, let alone refuse
  })

  assert.equal(r.ok, true)
})

test('a caption over the cap is refused by number', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: p1, [`incl_${p1}`]: 'on', [`didascalia_${p1}`]: 'a'.repeat(CAPTION_MAX + 1),
  })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Didascalia 1/)
})

test('a blank caption is stored as absent, not as an empty string', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)

  await file(db, photos, pendingPhotos, {
    foto_ids: p1, [`incl_${p1}`]: 'on', [`didascalia_${p1}`]: '   ',
  })

  const row = await db.get<{ caption: string | null }>('select caption from gita_photo')
  assert.equal(row?.caption, null)
})

test('one expired, included photo among several refuses all of them — nothing is written', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)
  const p2 = await pending(db, pendingPhotos, { expires: '2026-09-01T00:00:00.000Z' })

  const r = await file(db, photos, pendingPhotos, {
    foto_ids: `${p1},${p2}`, [`incl_${p1}`]: 'on', [`incl_${p2}`]: 'on',
  })

  assert.equal(r.ok, false)
  assert.equal((await db.all('select id from gita_photo')).length, 0)
})

test('photo problems join every other problem in the same pass', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos, { expires: '2026-09-01T00:00:00.000Z' })

  const r = await file(db, photos, pendingPhotos, {
    parole: '', foto_ids: p1, [`incl_${p1}`]: 'on',
  })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.ok(r.problems.length >= 2)
})

test('a foreign account\'s photo id is refused the same as an expired one — never promoted', async () => {
  const db = await freshDb(); await scene(db)
  await insertAccount(db, { id: 'a2', email: 'f@example.it', passwordHash: 'h', displayName: 'marco_t' })
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const foreign = await pending(db, pendingPhotos, { accountId: 'a2' })

  const r = await file(db, photos, pendingPhotos, { foto_ids: foreign, [`incl_${foreign}`]: 'on' })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.problems.join(' '), /Foto 1/)
})

test('the same pending id submitted twice: the second publish is refused, not re-promoted', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)

  const first = await file(db, photos, pendingPhotos, { foto_ids: p1, [`incl_${p1}`]: 'on' })
  assert.equal(first.ok, true)

  const second = await file(db, photos, pendingPhotos, { foto_ids: p1, [`incl_${p1}`]: 'on' })
  assert.equal(second.ok, false)
  if (second.ok) return
  assert.match(second.problems.join(' '), /scaduta/, '"already promoted" and "never existed" are the same result on purpose')
})

test('a promoted photo\'s bytes move from the pending store to the real one, and the pending row and file are both gone', async () => {
  const db = await freshDb(); await scene(db)
  const photos = memoryPhotoStore(); const pendingPhotos = memoryPhotoStore()
  const p1 = await pending(db, pendingPhotos)

  const r = await file(db, photos, pendingPhotos, { foto_ids: p1, [`incl_${p1}`]: 'on' })
  assert.equal(r.ok, true)

  assert.deepEqual(await photos.get(p1, 'image/jpeg'), JPEG)
  assert.equal(await pendingPhotos.get(p1, 'image/jpeg'), null)
})
