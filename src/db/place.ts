import type { Db } from './open.ts'

export interface PlaceRow {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly parentId: string | null
}

/**
 * A place identified by its natural key — name plus kind, and the parent where
 * the caller knows it. Italy has comuni that share a name across provinces
 * (Samone in TO and in TN), so the seed, which does know the province, asks
 * with it; the importer, whose rows carry a name and nothing else, cannot.
 */
export async function findPlaceByName(
  db: Db, name: string, kind: string, parentId?: string | null,
): Promise<{ id: string } | undefined> {
  return parentId === undefined
    ? db.get<{ id: string }>('select id from place where name = ? and kind = ?', [name, kind])
    : db.get<{ id: string }>('select id from place where name = ? and kind = ? and parent_id is ?',
      [name, kind, parentId])
}

/**
 * Gives a place a position where it has none. Never moves one it has: a
 * position somebody set by hand is not overwritten by a later list.
 */
export async function placeWherever(db: Db, id: string, lat: number, lon: number): Promise<void> {
  await db.run('update place set lat = ?, lon = ? where id = ? and lat is null and lon is null', [lat, lon, id])
}

export interface NewPlace {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly parentId: string | null
  /**
   * Where the place is, for places you travel FROM. Most have none: a valley is
   * better described by the routes in it than by a point somebody chose, and
   * `placeCentre` derives that. A city nobody climbs in has no routes to derive
   * from, which is why this column exists.
   */
  readonly lat?: number | null
  readonly lon?: number | null
}

export async function insertPlace(db: Db, place: NewPlace): Promise<void> {
  await db.run(
    'insert into place (id, name, kind, parent_id, lat, lon) values (?, ?, ?, ?, ?, ?)',
    [place.id, place.name, place.kind, place.parentId, place.lat ?? null, place.lon ?? null])
}

/**
 * Puts a place inside a named area — a comune in its valley — where the
 * administrative hierarchy cannot. Idempotent, like the seed that calls it.
 */
export async function addToArea(db: Db, placeId: string, areaId: string): Promise<void> {
  await db.run('insert or ignore into place_area (place_id, area_id) values (?, ?)', [placeId, areaId])
}

/** The place and every ancestor above it, root first — the breadcrumb, in order. */
export async function ancestorsOf(db: Db, placeId: string): Promise<PlaceRow[]> {
  const rows = await db.all<{ id: string; name: string; kind: string; parent_id: string | null }>(`
    with recursive up(id, name, kind, parent_id, depth) as (
      select id, name, kind, parent_id, 0 from place where id = ?
      union all
      select p.id, p.name, p.kind, p.parent_id, up.depth + 1
      from place p join up on p.id = up.parent_id
      where up.depth < 16
    )
    select id, name, kind, parent_id from up order by depth desc
  `, [placeId])

  return rows.map(r => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id }))
}

/**
 * Every place called one of these names, case aside — what Find could take
 * each name for. Ordered as `vocabularyOf` orders the whole archive, so a
 * parse over these rows breaks a tie between two Samone exactly as Find does.
 *
 * `lower` folds ASCII only, where the parser also folds accents; a namesake
 * that differs from a crumb by an accent alone is the one this cannot see.
 */
export async function placesNamed(
  db: Db, names: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (names.length === 0) return []
  return db.all<{ id: string; name: string }>(
    `select id, name from place where lower(name) in (${names.map(() => 'lower(?)').join(', ')})
     order by name, id`, names)
}
