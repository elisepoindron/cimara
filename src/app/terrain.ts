import { createHash } from 'node:crypto'
import type { Db } from '../db/open.ts'
import { profileCacheFor, saveProfileCache } from '../db/profile.ts'
import { profileOf, resample, SLOPE_REACH_M, type HeightAt, type ProfileSample } from '../domain/profile.ts'
import type { TrackPoint } from '../domain/track.ts'
import { decodePng, type Pixels } from './png.ts'
import { within } from './weather.ts'

/** One terrain tile's PNG bytes, or null where the service has none. */
export type FetchTile = (z: number, x: number, y: number) => Promise<Uint8Array | null>

/** About ten metres a pixel in the Alps: finer than the terrain under it was measured. */
export const TERRAIN_ZOOM = 14

const DAY_MS = 24 * 60 * 60 * 1000
/** A profile that could not be read is asked for again the next day. */
const MISS_TTL_MS = DAY_MS
/** A courtesy to a free service: never more than this many tiles asked at once. */
const PARALLEL = 6
const M_PER_DEG_LAT = Math.PI * 6_371_000 / 180

/** A fingerprint of a track's points: a new track, a new profile. */
export function trackKey(points: readonly TrackPoint[]): string {
  return createHash('sha1').update(JSON.stringify(points)).digest('base64url').slice(0, 16)
}

function tileOf(lat: number, lon: number, z: number): { x: number; y: number; fx: number; fy: number } {
  const n = 2 ** z
  const fx = (lon + 180) / 360 * n
  const r = lat * Math.PI / 180
  const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy }
}

/** Terrarium's encoding: the height in metres from a pixel's three bytes. */
const heightOf = (p: Pixels, i: number, j: number): number => {
  const x = Math.max(0, Math.min(p.width - 1, i)), y = Math.max(0, Math.min(p.height - 1, j))
  const o = (y * p.width + x) * p.channels
  return p.data[o]! * 256 + p.data[o + 1]! + p.data[o + 2]! / 256 - 32768
}

/**
 * The ground along a track, read from terrain tiles: every tile the line and
 * the points beside it fall on, fetched once, then a height anywhere on them
 * by bilinear interpolation. null wherever a tile was missing.
 */
export async function terrainAlong(points: readonly TrackPoint[], fetchTile: FetchTile, z = TERRAIN_ZOOM): Promise<HeightAt> {
  const wanted = new Map<string, { x: number; y: number }>()
  for (const p of resample(points)) {
    const dLat = SLOPE_REACH_M / M_PER_DEG_LAT
    const dLon = SLOPE_REACH_M / (M_PER_DEG_LAT * Math.cos(p.lat * Math.PI / 180))
    for (const [la, lo] of [[p.lat, p.lon], [p.lat + dLat, p.lon], [p.lat - dLat, p.lon], [p.lat, p.lon + dLon], [p.lat, p.lon - dLon]] as const) {
      const t = tileOf(la, lo, z)
      wanted.set(`${t.x}/${t.y}`, t)
    }
  }
  const tiles = new Map<string, Pixels | null>()
  const queue = [...wanted.entries()]
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, t] = next
      const bytes = await fetchTile(z, t.x, t.y)
      tiles.set(key, bytes ? decodePng(bytes) : null)
    }
  }))
  return (lat, lon) => {
    const t = tileOf(lat, lon, z)
    const px = tiles.get(`${t.x}/${t.y}`)
    if (!px) return null
    const u = (t.fx - t.x) * px.width - 0.5, v = (t.fy - t.y) * px.height - 0.5
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j
    return heightOf(px, i, j) * (1 - a) * (1 - b) + heightOf(px, i + 1, j) * a * (1 - b)
      + heightOf(px, i, j + 1) * (1 - a) * b + heightOf(px, i + 1, j + 1) * a * b
  }
}

/** Two visitors opening the same route at once read its ground once. */
const inFlight = new Map<string, Promise<ProfileSample[] | null>>()

export interface ProfileOpts {
  /** How long the page may wait for a first reading before it is drawn without one. */
  readonly waitMs?: number
}

/**
 * A route's profile along its track: from the cache when it was read along
 * this same track, otherwise read from the terrain, waited for at most
 * `waitMs` and then finished in the background, as weatherFor does. A reading
 * that failed outright is not kept and is tried again on the next visit; one
 * that found a hole in the terrain is kept as none, for a day.
 */
export async function profileFor(
  db: Db, itineraryId: string, points: readonly TrackPoint[], now: Date, fetchTile: FetchTile,
  opts: ProfileOpts = {},
): Promise<readonly ProfileSample[] | null> {
  const key = trackKey(points)
  const cached = await profileCacheFor(db, itineraryId)
  if (cached && cached.trackKey === key) {
    if (cached.samples) return cached.samples
    if (now.getTime() - Date.parse(cached.fetchedAt) < MISS_TTL_MS) return null
  }

  let job = inFlight.get(itineraryId)
  if (!job) {
    job = terrainAlong(points, fetchTile)
      .then(heightAt => profileOf(points, heightAt))
      .then(async samples => { await saveProfileCache(db, itineraryId, key, samples, now.toISOString()); return samples })
      .catch(err => { console.error('terrain read failed, no profile for now:', err); return null })
      .finally(() => inFlight.delete(itineraryId))
    inFlight.set(itineraryId, job)
  }
  const waitMs = opts.waitMs ?? 0
  return waitMs > 0 ? within(job, waitMs) : null
}
