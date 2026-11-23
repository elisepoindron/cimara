import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trailFor, type FetchTrail } from '../../src/app/trail.ts'
import { saveTrailCache, trailCacheFor } from '../../src/db/trail.ts'
import { trailFrom } from '../../src/app/trail-client.ts'
import type { Trail } from '../../src/domain/trail.ts'
import { freshDb } from '../helpers/db.ts'

const parking = { lat: 45.0587, lon: 7.1443 }
const crag = { lat: 45.06, lon: 7.15 }
const good: Trail = { coords: [[7.1443, 45.0587], [7.147, 45.0595], [7.15, 45.06]], lengthM: 620, ascentM: 85 }
const settle = () => new Promise(r => setTimeout(r, 0))

test('nothing cached: returns null, and asks the router in the background', async () => {
  const db = await freshDb()
  let calls = 0
  const fetchTrail: FetchTrail = async () => { calls++; return good }

  assert.equal(await trailFor(db, parking, crag, new Date('2026-11-15T10:00:00Z'), fetchTrail), null)
  assert.equal(calls, 1)
  await settle()
  assert.deepEqual((await trailCacheFor(db, parking, crag))?.trail, good)
})

test('a kept trail is served as it is for a month, without asking again', async () => {
  const db = await freshDb()
  await saveTrailCache(db, parking, crag, good, '2026-11-01T10:00:00.000Z')
  let calls = 0
  const fetchTrail: FetchTrail = async () => { calls++; return good }

  assert.deepEqual(await trailFor(db, parking, crag, new Date('2026-11-15T10:00:00Z'), fetchTrail), good)
  assert.equal(calls, 0)
})

test('a trail that does not reach the wall is cached as no trail, never drawn', async () => {
  const db = await freshDb()
  const short: Trail = { coords: [[7.1443, 45.0587], [7.145, 45.0592]], lengthM: 100, ascentM: 5 }
  const now = new Date('2026-11-15T10:00:00Z')

  await trailFor(db, parking, crag, now, async () => short)
  await settle()
  const cached = await trailCacheFor(db, parking, crag)
  assert.equal(cached?.trail, null)
  assert.equal(cached?.fetchedAt, now.toISOString())
})

test('no trail is asked about again the next day, not on every view', async () => {
  const db = await freshDb()
  await saveTrailCache(db, parking, crag, null, '2026-11-15T08:00:00.000Z')
  let calls = 0
  const fetchTrail: FetchTrail = async () => { calls++; return good }

  await trailFor(db, parking, crag, new Date('2026-11-15T10:00:00Z'), fetchTrail)
  assert.equal(calls, 0, 'two hours later')
  await trailFor(db, parking, crag, new Date('2026-11-16T09:00:00Z'), fetchTrail)
  assert.equal(calls, 1, 'a day later')
})

test('two views at once ask the router once', async () => {
  const db = await freshDb()
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const fetchTrail: FetchTrail = async () => { calls++; await gate; return good }
  const now = new Date('2026-11-15T10:00:00Z')

  await trailFor(db, parking, crag, now, fetchTrail)
  await trailFor(db, parking, crag, now, fetchTrail)
  assert.equal(calls, 1)
  release()
  await settle()
})

test('a failed fetch is caught, and the previous trail stays', async () => {
  const db = await freshDb()
  await saveTrailCache(db, parking, crag, good, '2026-09-01T10:00:00.000Z')
  const original = console.error
  console.error = () => {}
  try {
    const result = await trailFor(db, parking, crag, new Date('2026-11-15T10:00:00Z'),
      async () => { throw new Error('offline') })
    assert.deepEqual(result, good, 'the stale trail is still what this view gets')
    await settle()
    assert.deepEqual((await trailCacheFor(db, parking, crag))?.trail, good)
  } finally {
    console.error = original
  }
})

test('a router answer becomes [lon, lat] pairs, its length and its climb', () => {
  const trail = trailFrom({
    features: [{
      geometry: { coordinates: [[7.144301, 45.058712, 900], [7.150004, 45.059996, 980]] },
      properties: { 'track-length': '615', 'filtered ascend': '82' },
    }],
  })
  assert.deepEqual(trail, { coords: [[7.1443, 45.05871], [7.15, 45.06]], lengthM: 615, ascentM: 82 })
})

test('a router answer with no line or no length is no trail', () => {
  assert.equal(trailFrom({}), null)
  assert.equal(trailFrom({ features: [{ geometry: { coordinates: [[7, 45]] }, properties: { 'track-length': '1' } }] }), null)
  assert.equal(trailFrom({ features: [{ geometry: { coordinates: [[7, 45], [7.1, 45]] }, properties: {} }] }), null)
})
