import type { Db } from './open.ts'
import type { StoredFacts } from '../domain/facts.ts'

export async function addFavorite(
  db: Db, accountId: string, itineraryId: string, createdIso: string,
): Promise<void> {
  await db.run(
    `insert into favorite (account_id, itinerary_id, created) values (?, ?, ?)
     on conflict (account_id, itinerary_id) do nothing`,
    [accountId, itineraryId, createdIso])
}

export async function removeFavorite(
  db: Db, accountId: string, itineraryId: string,
): Promise<void> {
  await db.run(
    `delete from favorite where account_id = ? and itinerary_id = ?`,
    [accountId, itineraryId])
}

export async function isFavorite(
  db: Db, accountId: string, itineraryId: string,
): Promise<boolean> {
  const row = await db.get<{ n: number }>(
    `select count(*) as n from favorite where account_id = ? and itinerary_id = ?`,
    [accountId, itineraryId])
  return (row?.n ?? 0) > 0
}

/** One query for a whole page of rows: a query per star would be a query per row. */
export async function favoriteIdsOf(
  db: Db, accountId: string, itineraryIds: readonly string[],
): Promise<Set<string>> {
  if (itineraryIds.length === 0) return new Set()

  const placeholders = itineraryIds.map(() => '?').join(', ')
  const rows = await db.all<{ itinerary_id: string }>(
    `select itinerary_id from favorite
     where account_id = ? and itinerary_id in (${placeholders})`,
    [accountId, ...itineraryIds])
  return new Set(rows.map(r => r.itinerary_id))
}

export interface FavoriteJoinRow {
  readonly id: string
  readonly activity: string
  readonly name: string
  readonly placeId: string
  readonly placeName: string
  readonly gradeMin: number | null
  readonly gradeMax: number | null
  readonly facts: StoredFacts
  readonly created: string
}

interface RawFavoriteJoin {
  id: string; activity: string; name: string; place_id: string; place_name: string
  grade_min: number | null; grade_max: number | null; facts: string; created: string
}

/** The list page's own query: `favorite` joined out to what a row needs to show,
 * most recently favorited first. */
export async function favoriteRowsOf(db: Db, accountId: string): Promise<FavoriteJoinRow[]> {
  const rows = await db.all<RawFavoriteJoin>(`
    select i.id, i.activity, i.name, i.place_id, p.name as place_name,
           i.grade_min, i.grade_max, i.facts, f.created
    from favorite f
    join itinerary i on i.id = f.itinerary_id
    join place p on p.id = i.place_id
    where f.account_id = ?
    order by f.created desc, i.id`, [accountId])

  return rows.map(r => ({
    id: r.id, activity: r.activity, name: r.name,
    placeId: r.place_id, placeName: r.place_name,
    gradeMin: r.grade_min, gradeMax: r.grade_max,
    facts: JSON.parse(r.facts) as StoredFacts, created: r.created,
  }))
}
