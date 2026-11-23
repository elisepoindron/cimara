import type { Db } from '../db/open.ts'
import { saveTrailCache, trailCacheFor } from '../db/trail.ts'
import type { Point } from '../domain/geo.ts'
import { trailJoins, type Trail } from '../domain/trail.ts'

/** Asks a hiking router for the path between two points. null: it found none. */
export type FetchTrail = (from: Point, to: Point) => Promise<Trail | null>

const DAY_MS = 24 * 60 * 60 * 1000
/** Trails move slowly: a kept path is asked for again after a month. */
const KEPT_TTL_MS = 30 * DAY_MS
/** An answer that was no use is retried the next day, in case the map was filled in. */
const MISS_TTL_MS = DAY_MS

const round5 = (n: number) => Math.round(n * 1e5) / 1e5
const rounded = (p: Point): Point => ({ lat: round5(p.lat), lon: round5(p.lon) })

/**
 * The public router is a courtesy service: two visitors opening the same crag
 * at once must not ask it twice. Keyed by the rounded pair, cleared when the
 * fetch settles.
 */
const inFlight = new Set<string>()

/**
 * Cache-or-refetch, never blocking a request on the router — the discipline
 * weatherFor follows. A cached path is returned as it is; a stale or missing
 * row starts a background fetch and this request gets what is cached now, or
 * null, and the map draws its straight line. A path that does not join the
 * two points (trailJoins) is cached as no path, so it is never drawn.
 */
export async function trailFor(
  db: Db, from: Point, to: Point, now: Date, fetchTrail: FetchTrail,
): Promise<Trail | null> {
  const a = rounded(from)
  const b = rounded(to)
  const cached = await trailCacheFor(db, a, b)
  const age = cached === null ? Infinity : now.getTime() - Date.parse(cached.fetchedAt)
  const ttl = cached?.trail ? KEPT_TTL_MS : MISS_TTL_MS
  const key = `${a.lat},${a.lon};${b.lat},${b.lon}`

  if (age >= ttl && !inFlight.has(key)) {
    inFlight.add(key)
    fetchTrail(from, to)
      .then(t => saveTrailCache(db, a, b, t && trailJoins(t, from, to) ? t : null, now.toISOString()))
      .catch(err => console.error('trail fetch failed, keeping the previous cache:', err))
      .finally(() => inFlight.delete(key))
  }

  return cached?.trail ?? null
}
