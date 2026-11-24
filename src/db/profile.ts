import type { Db } from './open.ts'
import type { ProfileSample } from '../domain/profile.ts'

export interface CachedProfile {
  /** The fingerprint of the track this profile was read along. */
  readonly trackKey: string
  /** null: the terrain was asked and could not be read all along the line. */
  readonly samples: readonly ProfileSample[] | null
  readonly fetchedAt: string
}

/** One row per route; reading it again replaces it. */
export async function saveProfileCache(
  db: Db, itineraryId: string, trackKey: string, samples: readonly ProfileSample[] | null, fetchedAt: string,
): Promise<void> {
  await db.run(
    `insert into profile_cache (itinerary_id, track_key, samples, fetched_at) values (?, ?, ?, ?)
     on conflict (itinerary_id) do update set
       track_key = excluded.track_key, samples = excluded.samples, fetched_at = excluded.fetched_at`,
    [itineraryId, trackKey, samples ? JSON.stringify(samples.map(p => [p.d, p.e, p.s, p.g])) : null, fetchedAt])
}

/** null: this route's profile has never been read. */
export async function profileCacheFor(db: Db, itineraryId: string): Promise<CachedProfile | null> {
  const row = await db.get<{ track_key: string; samples: string | null; fetched_at: string }>(
    'select track_key, samples, fetched_at from profile_cache where itinerary_id = ?', [itineraryId])
  if (!row) return null
  return { trackKey: row.track_key, samples: row.samples === null ? null : readSamples(row.samples), fetchedAt: row.fetched_at }
}

function readSamples(text: string): ProfileSample[] | null {
  try {
    const v: unknown = JSON.parse(text)
    if (!Array.isArray(v) || v.length < 2) return null
    if (!v.every(p => Array.isArray(p) && p.length === 4 && p.every(n => typeof n === 'number'))) return null
    return (v as number[][]).map(([d, e, s, g]) => ({ d: d!, e: e!, s: s!, g: g! }))
  } catch {
    return null
  }
}
