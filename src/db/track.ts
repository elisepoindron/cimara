import type { Db } from './open.ts'
import type { TrackPoint } from '../domain/track.ts'

/** A route's recorded track, as stored: its points and where they came from. */
export interface StoredTrack {
  readonly points: readonly TrackPoint[]
  readonly source: string
}

/** Keeps a route's track. A route has one: saving again replaces it. */
export async function saveTrack(
  db: Db, itineraryId: string, points: readonly TrackPoint[], source: string,
): Promise<void> {
  await db.run(
    `insert into itinerary_track (itinerary_id, coords, source) values (?, ?, ?)
     on conflict (itinerary_id) do update set coords = excluded.coords, source = excluded.source`,
    [itineraryId, JSON.stringify(points), source])
}

/** null: nobody gave this route a track, or what is stored no longer reads as one. */
export async function trackFor(db: Db, itineraryId: string): Promise<StoredTrack | null> {
  const row = await db.get<{ coords: string; source: string }>(
    'select coords, source from itinerary_track where itinerary_id = ?', [itineraryId])
  if (!row) return null
  const points = readPoints(row.coords)
  return points && { points, source: row.source }
}

/** Whether a route already has a track, without reading it. */
export async function hasTrack(db: Db, itineraryId: string): Promise<boolean> {
  return (await db.get('select 1 from itinerary_track where itinerary_id = ?', [itineraryId])) !== undefined
}

function readPoints(text: string): TrackPoint[] | null {
  try {
    const v: unknown = JSON.parse(text)
    if (!Array.isArray(v) || v.length < 2) return null
    const ok = v.every(p => Array.isArray(p) && p.length === 3
      && typeof p[0] === 'number' && typeof p[1] === 'number'
      && (p[2] === null || typeof p[2] === 'number'))
    return ok ? v as TrackPoint[] : null
  } catch {
    return null
  }
}
