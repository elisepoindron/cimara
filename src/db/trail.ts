import type { Db } from './open.ts'
import type { Point } from '../domain/geo.ts'
import type { Trail } from '../domain/trail.ts'

export interface CachedTrail {
  /** null: the router was asked, and what it gave is not drawn. */
  readonly trail: Trail | null
  readonly fetchedAt: string
}

/** One row per pair of rounded points; a refresh replaces it, older never over newer. */
export async function saveTrailCache(
  db: Db, from: Point, to: Point, trail: Trail | null, fetchedAt: string,
): Promise<void> {
  await db.run(
    `insert into trail_cache (from_lat, from_lon, to_lat, to_lon, fetched_at, coords, length_m, ascent_m)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (from_lat, from_lon, to_lat, to_lon) do update set
       fetched_at = excluded.fetched_at,
       coords = excluded.coords,
       length_m = excluded.length_m,
       ascent_m = excluded.ascent_m
     where excluded.fetched_at >= trail_cache.fetched_at`,
    [from.lat, from.lon, to.lat, to.lon, fetchedAt,
     trail ? JSON.stringify(trail.coords) : null,
     trail ? Math.round(trail.lengthM) : null,
     trail && trail.ascentM !== null ? Math.round(trail.ascentM) : null])
}

interface RawTrail {
  fetched_at: string; coords: string | null; length_m: number | null; ascent_m: number | null
}

/** null: this pair has never been asked about. */
export async function trailCacheFor(db: Db, from: Point, to: Point): Promise<CachedTrail | null> {
  const row = await db.get<RawTrail>(
    `select fetched_at, coords, length_m, ascent_m from trail_cache
     where from_lat = ? and from_lon = ? and to_lat = ? and to_lon = ?`,
    [from.lat, from.lon, to.lat, to.lon])
  if (!row) return null
  const coords = readCoords(row.coords)
  return {
    fetchedAt: row.fetched_at,
    trail: coords && row.length_m !== null ? { coords, lengthM: row.length_m, ascentM: row.ascent_m } : null,
  }
}

/** Stored JSON that does not parse into at least two [lon, lat] pairs is no trail. */
function readCoords(text: string | null): [number, number][] | null {
  if (text === null) return null
  try {
    const v: unknown = JSON.parse(text)
    if (!Array.isArray(v) || v.length < 2) return null
    const ok = v.every(c => Array.isArray(c) && c.length === 2
      && typeof c[0] === 'number' && typeof c[1] === 'number')
    return ok ? v as [number, number][] : null
  } catch {
    return null
  }
}
