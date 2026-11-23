import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { filesystemPhotoStore } from '../../src/app/photo-store.ts'
import {
  insertPendingPhoto, livePendingPhotos, expiredPendingPhotos, deletePendingPhotos,
} from '../../src/db/pending-photo.ts'
import type { Db } from '../../src/db/open.ts'

test('a filesystem store forgets a photo once removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-pending-'))
  try {
    const store = filesystemPhotoStore(dir)
    await store.put('a1', 'image/jpeg', Buffer.from([1, 2, 3]))
    assert.deepEqual(await store.get('a1', 'image/jpeg'), Buffer.from([1, 2, 3]))

    await store.remove('a1', 'image/jpeg')
    assert.equal(await store.get('a1', 'image/jpeg'), null)
  } finally { await rm(dir, { recursive: true }) }
})

test('removing a photo that was never there is not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-pending-'))
  try {
    const store = filesystemPhotoStore(dir)
    await assert.doesNotReject(store.remove('non-esiste', 'image/jpeg'))
  } finally { await rm(dir, { recursive: true }) }
})

async function scene(db: Db) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertAccount(db, { id: 'a2', email: 'f@example.it', passwordHash: 'h', displayName: 'marco_t' })
}

test('an inserted pending photo comes back from a live lookup', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'p1', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })

  const live = await livePendingPhotos(db, 'a1', ['p1'], '2026-09-10T18:00:00.000Z')
  assert.deepEqual(live, [{ id: 'p1', mime: 'image/jpeg' }])
})

test('a live lookup is empty once past its own expiry', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'p1', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })

  const live = await livePendingPhotos(db, 'a1', ['p1'], '2026-09-11T12:00:01.000Z')
  assert.deepEqual(live, [])
})

test("a live lookup is scoped to the account — someone else's id is not yours", async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'p1', accountId: 'a2', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })

  const live = await livePendingPhotos(db, 'a1', ['p1'], '2026-09-10T18:00:00.000Z')
  assert.deepEqual(live, [], "a1 asked for a1's pending photos, not a2's")
})

test('a live lookup keeps the order ids were asked for, not insertion order', async () => {
  const db = await freshDb(); await scene(db)
  const at = { created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z' }
  await insertPendingPhoto(db, { id: 'p1', accountId: 'a1', mime: 'image/jpeg', ...at })
  await insertPendingPhoto(db, { id: 'p2', accountId: 'a1', mime: 'image/png', ...at })

  const live = await livePendingPhotos(db, 'a1', ['p2', 'p1'], '2026-09-10T18:00:00.000Z')
  assert.deepEqual(live.map(p => p.id), ['p2', 'p1'])
})

test('a live lookup silently drops an id that does not exist at all', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'p1', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })

  const live = await livePendingPhotos(db, 'a1', ['p1', 'non-esiste'], '2026-09-10T18:00:00.000Z')
  assert.deepEqual(live.map(p => p.id), ['p1'])
})

test('an empty id list is a live lookup that asks the database nothing', async () => {
  const db = await freshDb(); await scene(db)
  assert.deepEqual(await livePendingPhotos(db, 'a1', [], '2026-09-10T18:00:00.000Z'), [])
})

test('expiredPendingPhotos finds exactly the expired ones, scoped to the account', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'gone', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-09T12:00:00.000Z', expires: '2026-09-10T12:00:00.000Z',
  })
  await insertPendingPhoto(db, {
    id: 'still-good', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-12T12:00:00.000Z',
  })
  await insertPendingPhoto(db, {
    id: 'someone-elses-expired', accountId: 'a2', mime: 'image/jpeg',
    created: '2026-09-09T12:00:00.000Z', expires: '2026-09-10T12:00:00.000Z',
  })

  const expired = await expiredPendingPhotos(db, 'a1', '2026-09-11T00:00:00.000Z')
  assert.deepEqual(expired.map(p => p.id), ['gone'])
})

test('deletePendingPhotos removes exactly the ids named, leaves the rest', async () => {
  const db = await freshDb(); await scene(db)
  const at = { created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z' }
  await insertPendingPhoto(db, { id: 'p1', accountId: 'a1', mime: 'image/jpeg', ...at })
  await insertPendingPhoto(db, { id: 'p2', accountId: 'a1', mime: 'image/jpeg', ...at })

  await deletePendingPhotos(db, 'a1', ['p1'])

  assert.deepEqual(await livePendingPhotos(db, 'a1', ['p1', 'p2'], '2026-09-10T18:00:00.000Z'),
    [{ id: 'p2', mime: 'image/jpeg' }])
})

test('deletePendingPhotos with no ids deletes nothing and asks the database nothing', async () => {
  const db = await freshDb(); await scene(db)
  await insertPendingPhoto(db, {
    id: 'p1', accountId: 'a1', mime: 'image/jpeg',
    created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z',
  })

  await deletePendingPhotos(db, 'a1', [])
  assert.deepEqual(await livePendingPhotos(db, 'a1', ['p1'], '2026-09-10T18:00:00.000Z'),
    [{ id: 'p1', mime: 'image/jpeg' }])
})

test('deletePendingPhotos is scoped to its own account — someone else\'s id in the list is not touched', async () => {
  const db = await freshDb(); await scene(db)
  const at = { created: '2026-09-10T12:00:00.000Z', expires: '2026-09-11T12:00:00.000Z' }
  await insertPendingPhoto(db, { id: 'p1', accountId: 'a1', mime: 'image/jpeg', ...at })
  await insertPendingPhoto(db, { id: 'p2', accountId: 'a2', mime: 'image/jpeg', ...at })

  // a1's own delete list implausibly includes a2's id — it must still only
  // ever remove a1's own rows, the same account scope livePendingPhotos holds.
  await deletePendingPhotos(db, 'a1', ['p1', 'p2'])

  assert.deepEqual(await livePendingPhotos(db, 'a1', ['p1'], '2026-09-10T18:00:00.000Z'), [],
    "a1's own row is gone")
  assert.deepEqual(await livePendingPhotos(db, 'a2', ['p2'], '2026-09-10T18:00:00.000Z'),
    [{ id: 'p2', mime: 'image/jpeg' }], "a2's row survives a1's delete naming its id")
})
