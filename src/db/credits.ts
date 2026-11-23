import type { Db } from './open.ts'

/** When a page's description was last revised, and who wrote it, in the page's order. */
export interface PageCredits {
  /** A bare UTC day, or null where nothing records one. */
  readonly revised: string | null
  readonly authors: readonly string[]
}

export async function creditsOf(db: Db, itineraryId: string): Promise<PageCredits> {
  const row = await db.get<{ revised: string | null }>(
    `select revised from itinerary where id = ?`, [itineraryId])
  const authors = await db.all<{ display_name: string }>(
    `select a.display_name from itinerary_author ia join account a on a.id = ia.account_id
     where ia.itinerary_id = ? order by ia.position`, [itineraryId])
  return { revised: row?.revised ?? null, authors: authors.map(a => a.display_name) }
}

/** Sets the revision day only where none is held, so a second seed never moves it. */
export async function setRevisedIfUnset(db: Db, itineraryId: string, day: string): Promise<void> {
  await db.run(`update itinerary set revised = ? where id = ? and revised is null`, [day, itineraryId])
}

export async function hasAuthors(db: Db, itineraryId: string): Promise<boolean> {
  const row = await db.get<{ n: number }>(
    `select count(*) as n from itinerary_author where itinerary_id = ?`, [itineraryId])
  return (row?.n ?? 0) > 0
}

export async function addAuthor(db: Db, itineraryId: string, accountId: string, position: number): Promise<void> {
  await db.run(
    `insert into itinerary_author (itinerary_id, account_id, position) values (?, ?, ?)`,
    [itineraryId, accountId, position])
}
