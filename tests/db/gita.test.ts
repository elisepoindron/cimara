import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { fileGita, retractGita, giteFor, findGita, insertImportedReport, reportStatsFor, type NewGita } from '../../src/db/gita.ts'
import { insertPhotos, type NewPhoto } from '../../src/db/gita-photo.ts'
import { insertPendingPhoto, livePendingPhotos } from '../../src/db/pending-photo.ts'
import type { Db } from '../../src/db/open.ts'

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null,
    aspect: 'SE', altMax: 3000, facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
}

const G: NewGita = {
  id: 'g1', itineraryId: 'i1', accountId: 'a1',
  observedAt: '2026-09-05', filedAt: '2026-09-06T20:00:00.000Z',
  words: 'Neve dura sopra i 3200.',
}

test('filing writes the gita: its day and its words', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)

  const gite = await giteFor(db, 'i1')
  assert.equal(gite.length, 1)
  assert.equal(gite[0]?.words, 'Neve dura sopra i 3200.')
  assert.equal(gite[0]?.authorName, 'vale74', 'the page shows the person, so the join belongs here')
})

test('a failure writes nothing', async () => {
  const db = await freshDb()
  await scene(db)

  // An itinerary that does not exist violates the foreign key.
  await assert.rejects(fileGita(db, { ...G, itineraryId: 'non-esiste' }))

  assert.equal((await giteFor(db, 'i1')).length, 0)
})

test('a retracted gita disappears from the list but is still findable', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)
  await retractGita(db, 'g1', '2026-09-07T08:00:00.000Z')

  assert.equal((await giteFor(db, 'i1')).length, 0)
  assert.ok(await findGita(db, 'g1'), 'history stays complete; only visibility changes')
})

test('nothing is deleted when a gita is retracted', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)
  await retractGita(db, 'g1', '2026-09-07T08:00:00.000Z')

  const gite = await db.all('select id from gita')
  assert.equal(gite.length, 1, 'withdrawing adds a retraction; the report is never destroyed')
})

test('gite come back most recently observed first', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)
  await fileGita(db, { ...G, id: 'g2', observedAt: '2026-09-08', words: 'Più recente.' })

  assert.deepEqual((await giteFor(db, 'i1')).map(g => g.id), ['g2', 'g1'])
})

test('two reports of the same day: the one written up later speaks first', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, { ...G, id: 'early', filedAt: '2026-09-05T19:00:00.000Z' })
  await fileGita(db, { ...G, id: 'late', filedAt: '2026-09-06T09:00:00.000Z' })

  assert.deepEqual((await giteFor(db, 'i1')).map(g => g.id), ['late', 'early'],
    'same day, so the tiebreak is when it was written up — and it is exercised here, ' +
    'which the day-ordering test above cannot do')
})

test('and if even that ties, the order is still stated rather than arbitrary', async () => {
  const db = await freshDb()
  await scene(db)
  // Two people filing the same instant about the same day. Nothing distinguishes
  // them but the id, and the page quotes whichever comes first — so which one
  // that is has to be a decision rather than whatever the database returns.
  await fileGita(db, { ...G, id: 'bbb' })
  await fileGita(db, { ...G, id: 'aaa' })

  assert.deepEqual((await giteFor(db, 'i1')).map(g => g.id), ['aaa', 'bbb'])
})

test('fileGita writes its photos in the same transaction as the form and the slip', async () => {
  const db = await freshDb()
  await scene(db)
  const photos: NewPhoto[] = [{ id: 'ph1', position: 0, caption: null, mime: 'image/jpeg' }]

  await fileGita(db, G, photos)

  const rows = await db.all<{ id: string; gita_id: string }>('select id, gita_id from gita_photo')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.gita_id, 'g1')
})

test('a gita with no photos writes none, as every existing test already assumes', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)

  assert.equal((await db.all('select id from gita_photo')).length, 0)
})

test('when the write fails, neither the gita nor its photos are written', async () => {
  const db = await freshDb()
  await scene(db)
  const photos: NewPhoto[] = [{ id: 'ph1', position: 0, caption: null, mime: 'image/jpeg' }]

  await assert.rejects(fileGita(db, { ...G, itineraryId: 'non-esiste' }, photos))

  assert.equal((await db.all('select id from gita_photo')).length, 0)
})

test('fileGita deletes the promoted pending_photo rows in the same transaction', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'ph1', accountId: G.accountId, mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })
  const photos: NewPhoto[] = [{ id: 'ph1', position: 0, caption: null, mime: 'image/jpeg' }]

  await fileGita(db, G, photos, ['ph1'])

  assert.deepEqual(
    await livePendingPhotos(db, G.accountId, ['ph1'], '2026-09-10T18:00:00.000Z'), [])
})

test('when the write fails, the pending_photo row is not deleted either', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'ph1', accountId: G.accountId, mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })
  // A valid itinerary, so the gita and observation inserts would succeed —
  // the failure has to come from the photo itself, position 6 violating
  // gita_photo's own `check(position between 0 and 5)`, or this test proves
  // nothing beyond "an invalid itinerary fails first," which the transaction
  // never even reaches insertPhotos or deletePendingPhotos to test.
  const photos: NewPhoto[] = [{ id: 'ph1', position: 6, caption: null, mime: 'image/jpeg' }]

  await assert.rejects(fileGita(db, G, photos, ['ph1']))

  assert.deepEqual(
    await livePendingPhotos(db, G.accountId, ['ph1'], '2026-09-10T18:00:00.000Z'),
    [{ id: 'ph1', mime: 'image/jpeg' }])
})

test('an imported report reads as a report beside filed gite, newest first, and counts', async () => {
  const db = await freshDb()
  await scene(db)
  await fileGita(db, G)                                          // 2026-09-05
  await insertImportedReport(db, { id: 'r-new', itineraryId: 'i1', observedAt: '2026-09-07',
    words: 'Chiodatura rifatta.' })
  await insertImportedReport(db, { id: 'r-old', itineraryId: 'i1', observedAt: '2026-08-30',
    words: 'Roccia asciutta.' })

  const gite = await giteFor(db, 'i1')
  assert.deepEqual(gite.map(g => g.id), ['r-new', 'g1', 'r-old'])
  assert.deepEqual([gite[0]!.authorName, gite[0]!.accountId], [null, null])
  assert.deepEqual(await reportStatsFor(db, 'i1', '2026-09-01'),
    { total: 3, recent: 2, lastReportAt: '2026-09-07' })
})

test('an imported report is not a gita: it cannot be found to be withdrawn', async () => {
  const db = await freshDb()
  await scene(db)
  await insertImportedReport(db, { id: 'r1', itineraryId: 'i1', observedAt: '2026-09-07',
    words: 'Chiodatura rifatta.' })
  assert.equal(await findGita(db, 'r1'), null)
})
