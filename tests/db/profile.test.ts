import { test } from 'node:test'
import assert from 'node:assert/strict'
import { profileCacheFor, saveProfileCache } from '../../src/db/profile.ts'
import { freshDb } from '../helpers/db.ts'
import { someItinerary } from '../helpers/terrain.ts'

const samples = [{ d: 0, e: 380, s: 8, g: 12 }, { d: 15, e: 382, s: 9, g: 13 }]

test('a profile is kept with the track it was read along, and replaced by the next', async () => {
  const db = await freshDb()
  const id = await someItinerary(db)
  assert.equal(await profileCacheFor(db, id), null)
  await saveProfileCache(db, id, 'k1', samples, '2026-11-24T10:00:00Z')
  assert.deepEqual(await profileCacheFor(db, id), { trackKey: 'k1', samples, fetchedAt: '2026-11-24T10:00:00Z' })
  await saveProfileCache(db, id, 'k2', null, '2026-11-25T10:00:00Z')
  assert.deepEqual(await profileCacheFor(db, id), { trackKey: 'k2', samples: null, fetchedAt: '2026-11-25T10:00:00Z' })
})
