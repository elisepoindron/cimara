import type { Db } from '../db/open.ts'
import {
  addFavorite as insertFavorite, removeFavorite as deleteFavorite,
  favoriteRowsOf, type FavoriteJoinRow,
} from '../db/favorite.ts'
import { partsOf } from '../db/itinerary.ts'
import { activityOf } from '../domain/activities/index.ts'
import { rowCellsOf, type RowSlot } from '../domain/row-facts.ts'
import { whereOf } from './find.ts'

export interface FavoriteRow {
  readonly id: string
  readonly name: string
  /** "CN Crissolo" — the same locality a Find row shows beside the name. */
  readonly where: string
  /** The facts line a Find row would show, with no distance: Preferiti names no place. */
  readonly cells: readonly RowSlot[]
}

async function shape(db: Db, r: FavoriteJoinRow): Promise<FavoriteRow> {
  return {
    id: r.id, name: r.name,
    where: await whereOf(db, r.placeId, r.placeName),
    cells: rowCellsOf(activityOf(r.activity), r.facts, await partsOf(db, r.id), null),
  }
}

/** Everything an account has starred, most recently starred first — no ranking,
 * no query narrowing: this is a list, not a search. */
export async function listFavorites(db: Db, accountId: string): Promise<FavoriteRow[]> {
  const rows = await favoriteRowsOf(db, accountId)
  return Promise.all(rows.map(r => shape(db, r)))
}

export async function addFavorite(
  db: Db, accountId: string, itineraryId: string, now: Date,
): Promise<void> {
  await insertFavorite(db, accountId, itineraryId, now.toISOString())
}

export async function removeFavorite(
  db: Db, accountId: string, itineraryId: string,
): Promise<void> {
  await deleteFavorite(db, accountId, itineraryId)
}
