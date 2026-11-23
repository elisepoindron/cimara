import type { Db } from '../db/open.ts'
import type { CandidateRow } from '../db/search.ts'
import { partsOf } from '../db/itinerary.ts'
import { activityOf } from '../domain/activities/index.ts'
import { rowCellsOf, type RowSlot } from '../domain/row-facts.ts'
import { whereOf } from './find.ts'

/** A route on home's map, with what its card says when the pin is clicked. */
export interface HomeRoute {
  readonly id: string
  readonly name: string
  readonly lat: number | null
  readonly lon: number | null
  readonly activity: string
  /** "CN Crissolo" — the locality a Find row shows beside the name. */
  readonly where: string
  /** The facts a Find row would show, with no distance: home names no place. */
  readonly cells: readonly RowSlot[]
}

/**
 * Home's sample, shaped for its pins' cards. Ungraded, like the sample itself:
 * grading is a query per route and nothing here asked for one. The facts cost
 * one read of parts per route; a locality is read once per place, since a
 * sample of hundreds of routes sits in a few dozen of them.
 */
export async function homeRoutes(db: Db, rows: readonly CandidateRow[]): Promise<HomeRoute[]> {
  const places = new Map<string, Promise<string>>()
  const where = (r: CandidateRow) => {
    let w = places.get(r.placeId)
    if (!w) places.set(r.placeId, w = whereOf(db, r.placeId, r.placeName))
    return w
  }

  return Promise.all(rows.map(async r => ({
    id: r.id, name: r.name, lat: r.lat, lon: r.lon, activity: r.activity,
    where: await where(r),
    cells: rowCellsOf(activityOf(r.activity), r.facts, await partsOf(db, r.id), null),
  })))
}
