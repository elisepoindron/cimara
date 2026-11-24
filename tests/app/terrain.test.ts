import { test } from 'node:test'
import assert from 'node:assert/strict'
import { profileFor, terrainAlong, trackKey, TERRAIN_ZOOM, type FetchTile } from '../../src/app/terrain.ts'
import { profileCacheFor, saveProfileCache } from '../../src/db/profile.ts'
import type { TrackPoint } from '../../src/domain/track.ts'
import { freshDb } from '../helpers/db.ts'
import { metresPerPixel, planeTiles, someItinerary, tileRow } from '../helpers/terrain.ts'

const LAT = 45.12
const M_PER_DEG_LAT = Math.PI * 6_371_000 / 180
// Due south, a fix every 20 m.
const track: TrackPoint[] = Array.from({ length: 30 }, (_, i) => [7.35, LAT - i * 20 / M_PER_DEG_LAT, null] as const)
const row0 = tileRow(LAT, TERRAIN_ZOOM) - 1
const RISE = 0.5
const settle = () => new Promise(r => setTimeout(r, 0))

test('terrainAlong: heights from the tiles, between their pixels, on a plane of known slope', async () => {
  const asked: string[] = []
  const heightAt = await terrainAlong(track, planeTiles(500, RISE, row0, 64, asked))
  const a = heightAt(LAT, 7.35)!, b = heightAt(LAT - 100 / M_PER_DEG_LAT, 7.35)!
  const mpp = metresPerPixel(LAT, TERRAIN_ZOOM, 64)
  // Southwards is down the tile, where the plane rises: 100 m south climbs 100 / mpp pixels' worth.
  assert.ok(Math.abs((b - a) - 100 / mpp * RISE) < 0.5, `${b - a}`)
  assert.equal(new Set(asked).size, asked.length, 'each tile asked for once')
})

test('a tile the service does not have leaves a hole: no reading there', async () => {
  const none: FetchTile = async () => null
  const heightAt = await terrainAlong(track, none)
  assert.equal(heightAt(LAT, 7.35), null)
})

test('first visit: read, waited for, kept; then served from the cache without asking', async () => {
  const db = await freshDb()
  const id = await someItinerary(db)
  const asked: string[] = []
  const tiles = planeTiles(500, RISE, row0, 64, asked)
  const first = await profileFor(db, id, track, new Date('2026-11-24T10:00:00Z'), tiles, { waitMs: 5000 })
  assert.ok(first && first.length > 30)
  // The track runs south, up the plane: a few per cent, all along.
  const pct = Math.round(RISE / metresPerPixel(LAT, TERRAIN_ZOOM, 64) * 100)
  assert.ok(first.slice(5, -5).every(s => s.g === pct), `gradient ${pct}%`)
  const n = asked.length
  const again = await profileFor(db, id, track, new Date('2026-11-25T10:00:00Z'), tiles, { waitMs: 5000 })
  assert.deepEqual(again, first)
  assert.equal(asked.length, n, 'the ground does not change: never asked again')
})

test('a new track is read again; a profile with a hole is kept as none, for a day', async () => {
  const db = await freshDb()
  const id = await someItinerary(db)
  await saveProfileCache(db, id, 'an-older-track', [{ d: 0, e: 1, s: 1, g: 1 }, { d: 15, e: 2, s: 1, g: 1 }], '2026-11-01T00:00:00Z')
  let calls = 0
  const none: FetchTile = async () => { calls++; return null }
  assert.equal(await profileFor(db, id, track, new Date('2026-11-24T10:00:00Z'), none, { waitMs: 5000 }), null)
  assert.ok(calls > 0, 'the old profile was for another track')
  const kept = await profileCacheFor(db, id)
  assert.equal(kept?.trackKey, trackKey(track))
  assert.equal(kept?.samples, null)
  calls = 0
  assert.equal(await profileFor(db, id, track, new Date('2026-11-24T20:00:00Z'), none, { waitMs: 5000 }), null)
  assert.equal(calls, 0, 'not asked again the same day')
  await profileFor(db, id, track, new Date('2026-11-25T11:00:00Z'), none, { waitMs: 5000 })
  assert.ok(calls > 0, 'asked again the next day')
})

test('a failed read is not kept, and without waiting the page gets nothing yet', async () => {
  const db = await freshDb()
  const id = await someItinerary(db)
  const broken: FetchTile = async () => { throw new Error('offline') }
  const quiet = console.error
  console.error = () => {}
  try {
    assert.equal(await profileFor(db, id, track, new Date(), broken), null)
    await settle(); await settle()
  } finally { console.error = quiet }
  assert.equal(await profileCacheFor(db, id), null)
})
