import type { Db } from './open.ts'
import type { Part, StoredFacts } from '../domain/facts.ts'
import type { Aspect } from '../domain/quantity.ts'
import { boundingBox, distanceM, type Point } from '../domain/geo.ts'

export interface ItineraryRow {
  readonly id: string
  readonly activity: string
  readonly placeId: string
  readonly name: string
  readonly lat: number | null
  readonly lon: number | null
  readonly parkingLat: number | null
  readonly parkingLon: number | null
  readonly aspect: Aspect | null
  readonly altMax: number | null
  readonly facts: StoredFacts
  readonly sections: Record<string, string>
}

interface RawItinerary {
  id: string; activity: string; place_id: string; name: string
  lat: number | null; lon: number | null
  parking_lat: number | null; parking_lon: number | null
  aspect: Aspect | null; alt_max: number | null
  facts: string; sections: string          // text columns, not JSON columns
}

const COLUMNS =
  'id, activity, place_id, name, lat, lon, parking_lat, parking_lon, aspect, alt_max, facts, sections'

function toRow(r: RawItinerary): ItineraryRow {
  return {
    id: r.id, activity: r.activity, placeId: r.place_id, name: r.name,
    lat: r.lat, lon: r.lon, parkingLat: r.parking_lat, parkingLon: r.parking_lon,
    aspect: r.aspect, altMax: r.alt_max,
    facts: JSON.parse(r.facts) as StoredFacts,
    sections: JSON.parse(r.sections) as Record<string, string>,
  }
}

export async function byId(db: Db, id: string): Promise<ItineraryRow | null> {
  const row = await db.get<RawItinerary>(`select ${COLUMNS} from itinerary where id = ?`, [id])
  return row ? toRow(row) : null
}

export async function allItineraries(db: Db): Promise<ItineraryRow[]> {
  const rows = await db.all<RawItinerary>(`select ${COLUMNS} from itinerary order by name`)
  return rows.map(toRow)
}

/**
 * A route looked up by name alone, returning the first of however many carry it.
 *
 * **This is not the natural key, and nothing that asks "is this route already
 * here?" may use it.** Names are not unique in an outdoor archive: there is a
 * Balma Scura in Crissolo and another in Bussoleno, two different crags an hour
 * apart. Asked by name alone they are one route, and an importer keyed on this
 * would write the first and silently drop the second — two real crags becoming
 * one, with no error anywhere. `findItineraryByNameInPlace` is the identity
 * question; this one is a convenience for a caller that already knows there is
 * only one, such as a test naming a seeded route.
 *
 * The seed still keys its idempotence on this, which is safe only because its
 * routes all have distinct names: a second Balma Scura added
 * to a seed set under a different comune would be dropped in the same
 * silence. One line, and worth changing the day the seed grows.
 */
export async function findItineraryByName(db: Db, name: string): Promise<{ id: string } | undefined> {
  return db.get<{ id: string }>('select id from itinerary where name = ?', [name])
}

/**
 * An itinerary identified by its natural key — its name and the place it is in.
 *
 * Both halves are necessary and neither is sufficient: a place holds many
 * routes, and a name is shared across places. What the pair still cannot tell
 * apart is two different routes with the same name in the *same* comune, which
 * is a real possibility and not one any column in any archive resolves. The
 * importer decides out loud what to do about that; see `src/import/run.ts`.
 */
export async function findItineraryByNameInPlace(
  db: Db, name: string, placeId: string,
): Promise<{ id: string } | undefined> {
  return db.get<{ id: string }>(
    'select id from itinerary where name = ? and place_id = ?', [name, placeId])
}

export interface NewItinerary {
  readonly id: string
  readonly activity: string
  readonly placeId: string
  readonly name: string
  readonly lat: number | null
  readonly lon: number | null
  readonly parkingLat: number | null
  readonly parkingLon: number | null
  readonly aspect: Aspect | null
  readonly altMax: number | null
  readonly facts: StoredFacts
  readonly sections: Record<string, string>
  readonly created: string
}

export async function insertItinerary(db: Db, it: NewItinerary): Promise<void> {
  await db.run(`
    insert into itinerary (id, activity, place_id, name, lat, lon, parking_lat, parking_lon,
                           aspect, alt_max, facts, sections, created)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [it.id, it.activity, it.placeId, it.name, it.lat, it.lon, it.parkingLat, it.parkingLon,
     it.aspect, it.altMax, JSON.stringify(it.facts), JSON.stringify(it.sections), it.created])
}

export interface NewPart {
  readonly id: string
  readonly itineraryId: string
  readonly group: string | null
  readonly position: number
  readonly fields: StoredFacts
}

export async function insertPart(db: Db, part: NewPart): Promise<void> {
  await db.run(`insert into part (id, itinerary_id, group_name, position, fields)
                values (?, ?, ?, ?, ?)`,
    [part.id, part.itineraryId, part.group, part.position, JSON.stringify(part.fields)])
}

/**
 * The grade bounds, written after the parts exist. A crag derives its range from
 * its pitches, and those are inserted after the itinerary they belong to, so
 * this cannot be part of the insert.
 */
export async function setGradeBounds(
  db: Db, itineraryId: string, bounds: { min: number; max: number } | null,
): Promise<void> {
  await db.run(`update itinerary set grade_min = ?, grade_max = ? where id = ?`,
    [bounds?.min ?? null, bounds?.max ?? null, itineraryId])
}

/** Records where a route's parking is. */
export async function setParking(db: Db, itineraryId: string, at: { lat: number; lon: number }): Promise<void> {
  await db.run(`update itinerary set parking_lat = ?, parking_lon = ? where id = ?`, [at.lat, at.lon, itineraryId])
}

/** Replaces a route's stored header facts with these. */
export async function setFacts(db: Db, itineraryId: string, facts: StoredFacts): Promise<void> {
  await db.run(`update itinerary set facts = ? where id = ?`, [JSON.stringify(facts), itineraryId])
}

export async function partsOf(db: Db, itineraryId: string): Promise<Part[]> {
  const rows = await db.all<{ id: string; group_name: string | null; position: number; fields: string }>(
    `select id, group_name, position, fields from part
     where itinerary_id = ?
     -- Numbers repeat across sectors (migration 018); rowid, the order the
     -- source listed them in, breaks the tie so a list never reshuffles.
     order by position, rowid`, [itineraryId])

  return rows.map(r => ({
    id: r.id,
    group: r.group_name,
    position: r.position,
    fields: JSON.parse(r.fields) as StoredFacts,
  }))
}

export interface NearbyRoute {
  readonly id: string
  readonly name: string
  /** Where it is, for the pin the page's map draws for it. */
  readonly lat: number
  readonly lon: number
  readonly distanceM: number
  readonly aspect: Aspect | null
  readonly altMax: number | null
  /** Standing reports — filed and not withdrawn, or imported — on or after `since`. */
  readonly recent: number
  /** The day of the newest standing report of any age; null when it has none. */
  readonly lastReportAt: string | null
}

/**
 * Routes near this one, for the page's own section of them: the same bounding
 * box, aspect and altitude test as `neighbours`, but counting reports rather
 * than reading verdicts, and keeping a route nobody has reported yet. Nothing
 * here grades anything: how recently someone went is said, never what they
 * found.
 *
 * A report is a gita nobody withdrew, or an imported one, exactly as `giteFor`
 * counts them. Nearest first, all of them; capping for display is the caller's.
 */
export async function nearbyRoutes(
  db: Db,
  of: ItineraryRow,
  opts: { withinM: number; sameAspect: boolean; altToleranceM: number | null; since: string },
): Promise<NearbyRoute[]> {
  if (of.lat === null || of.lon === null) return []

  const centre: Point = { lat: of.lat, lon: of.lon }
  const box = boundingBox(centre, opts.withinM)

  const rows = await db.all<{ id: string; name: string; lat: number; lon: number
                              aspect: Aspect | null; alt_max: number | null
                              recent: number; last_report_at: string | null }>(`
    with report as (
      select g.itinerary_id, g.observed_at from gita g
      where not exists (select 1 from retraction r where r.gita_id = g.id)
      union all
      select ir.itinerary_id, ir.observed_at from imported_report ir
    )
    select i.id, i.name, i.lat, i.lon, i.aspect, i.alt_max,
           (select count(*) from report r
             where r.itinerary_id = i.id and r.observed_at >= ?) as recent,
           (select max(r.observed_at) from report r where r.itinerary_id = i.id) as last_report_at
    from itinerary i
    where i.id <> ?
      and i.activity = ?
      and i.lat is not null and i.lon is not null
      and i.lat between ? and ?
      and i.lon between ? and ?
      and (? = 0 or (i.aspect is not null and i.aspect = ?))
      and (? is null or ? is null
           or (i.alt_max is not null and abs(i.alt_max - ?) <= ?))
  `, [
    opts.since,
    of.id, of.activity,
    box.minLat, box.maxLat, box.minLon, box.maxLon,
    opts.sameAspect ? 1 : 0, of.aspect,
    opts.altToleranceM, of.altMax, of.altMax, opts.altToleranceM,
  ])

  return rows
    .map(r => ({
      id: r.id, name: r.name, lat: r.lat, lon: r.lon, aspect: r.aspect, altMax: r.alt_max,
      recent: r.recent, lastReportAt: r.last_report_at,
      distanceM: distanceM(centre, { lat: r.lat, lon: r.lon }),
    }))
    .filter(n => n.distanceM <= opts.withinM)
    .sort((a, b) => a.distanceM - b.distanceM)
}

/** What `retireItinerary` did with a route it was asked to take away. */
export type Retired = 'retired' | 'absent' | 'kept'

/**
 * Takes away a route the seed once wrote and no longer holds, with what hangs
 * off it: its sectors, its unsigned reports and their photos, its summary of
 * themes and its credits. Found by name and comune, never by name alone: a
 * namesake elsewhere is another route.
 *
 * A route somebody has used is **kept**, whatever the seed says: a gita filed
 * on it or a star on it is a person's own, and nothing the seed decides may
 * delete it. Reports are append-only; this is not a way round that.
 */
export async function retireItinerary(db: Db, name: string, comune: string): Promise<Retired> {
  const row = await db.get<{ id: string }>(`
    select i.id from itinerary i join place p on p.id = i.place_id
    where i.name = ? and p.name = ? and p.kind = 'comune'`, [name, comune])
  if (!row) return 'absent'

  const used = await db.get<{ n: number }>(`
    select (select count(*) from gita where itinerary_id = ?)
         + (select count(*) from favorite where itinerary_id = ?) as n`, [row.id, row.id])
  if (used!.n > 0) return 'kept'

  await db.run(`delete from imported_report_photo where imported_report_id in
                  (select id from imported_report where itinerary_id = ?)`, [row.id])
  await db.run('delete from imported_report where itinerary_id = ?', [row.id])
  await db.run('delete from part where itinerary_id = ?', [row.id])
  await db.run('delete from synthesis where itinerary_id = ?', [row.id])
  await db.run('delete from itinerary_track where itinerary_id = ?', [row.id])
  await db.run('delete from itinerary_author where itinerary_id = ?', [row.id])
  await db.run('delete from itinerary where id = ?', [row.id])
  return 'retired'
}
