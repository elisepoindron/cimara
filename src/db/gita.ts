import type { Db } from './open.ts'
import { insertPhotos, type NewPhoto } from './gita-photo.ts'
import { deletePendingPhotos } from './pending-photo.ts'

export interface NewGita {
  readonly id: string
  readonly itineraryId: string
  readonly accountId: string
  readonly observedAt: string          // the day they went
  readonly filedAt: string             // the day they wrote it up
  readonly words: string
}

/**
 * A standing report on a route: a gita somebody filed here, or a report an
 * import brought in from another archive. An imported one has no account and
 * no author. Either is a date and words: nothing grades it.
 */
export interface GitaRow {
  readonly id: string
  readonly itineraryId: string
  readonly accountId: string | null
  readonly authorName: string | null
  readonly observedAt: string
  readonly filedAt: string
  readonly words: string
}

interface RawGita {
  id: string; itinerary_id: string; account_id: string | null; display_name: string | null
  observed_at: string; filed_at: string; words: string
}

const SELECT = `
  select g.id, g.itinerary_id, g.account_id, a.display_name,
         g.observed_at, g.filed_at, g.words
  from gita g join account a on a.id = g.account_id`

function toRow(r: RawGita): GitaRow {
  return {
    id: r.id, itineraryId: r.itinerary_id, accountId: r.account_id,
    authorName: r.display_name, observedAt: r.observed_at, filedAt: r.filed_at,
    words: r.words,
  }
}

/**
 * A gita and its photos, written together or not at all — and so
 * is the cleanup of whichever `pending_photo` rows those photos were
 * promoted from: a photo that made it into `gita_photo` must stop being
 * "still pending" in the same breath, not in a step that could fail on its
 * own.
 */
export async function fileGita(
  db: Db, g: NewGita, photos: readonly NewPhoto[] = [], pendingPhotoIds: readonly string[] = [],
): Promise<void> {
  await db.tx(async () => {
    await db.run(
      `insert into gita (id, itinerary_id, account_id, observed_at, filed_at, words)
       values (?, ?, ?, ?, ?, ?)`,
      [g.id, g.itineraryId, g.accountId, g.observedAt, g.filedAt, g.words])

    await insertPhotos(db, g.id, photos)
    await deletePendingPhotos(db, g.accountId, pendingPhotoIds)
  })
}

/**
 * Adds a row. Never deletes one — history stays complete, visibility changes.
 *
 * `gita_id` is the primary key, so withdrawing twice would violate it and turn
 * a double-clicked button into a 500. That one conflict is named and ignored,
 * rather than reached for with `insert or ignore`, which would swallow the
 * foreign key violation too and report success for a gita that does not exist.
 * The first withdrawal keeps its date: a second attempt writes nothing.
 */
export async function retractGita(db: Db, gitaId: string, atIso: string): Promise<void> {
  await db.run(
    `insert into retraction (gita_id, retracted_at) values (?, ?)
     on conflict (gita_id) do nothing`, [gitaId, atIso])
}

/**
 * Every standing report on a route, newest first.
 *
 * What does call it: the itinerary page, for the count and date behind the
 * relazioni section; the "leggi tutte" page, which is this list in full;
 * `regenerateSynthesis`, which sends the reports' own words to a model; and
 * the tests, to ask whether a route still holds standing reports, which is the
 * question retraction is about.
 */
export async function giteFor(db: Db, itineraryId: string): Promise<GitaRow[]> {
  const rows = await db.all<RawGita>(
    `${SELECT}
     where g.itinerary_id = ?
       and not exists (select 1 from retraction r where r.gita_id = g.id)
     union all
     -- An imported report, said the same way: no author, and filed the
     -- evening of the day it reports.
     select ir.id, ir.itinerary_id, null, null,
            ir.observed_at, ir.observed_at || 'T18:00:00.000Z', ir.words
     from imported_report ir
     where ir.itinerary_id = ?
     -- The id breaks the last tie. Two reports of the same day filed in the
     -- same instant would otherwise come back in whatever order the database
     -- felt like, and the page shows the first of them by name: an arbitrary
     -- order is still an order, and somebody would read meaning into which
     -- person was quoted.
     order by observed_at desc, filed_at desc, id`, [itineraryId, itineraryId])
  return rows.map(toRow)
}

/**
 * How much a route has been written about, for Find's row and ranking: every
 * standing report, how many fall on or after `since` (the activity's window),
 * and the day of the newest. Counted the way `giteFor` counts: a gita nobody
 * withdrew, or an imported report.
 */
export async function reportStatsFor(
  db: Db, itineraryId: string, since: string,
): Promise<{ total: number; recent: number; lastReportAt: string | null }> {
  const row = await db.get<{ total: number; recent: number; last: string | null }>(
    `with report as (
       select g.observed_at from gita g
       where g.itinerary_id = ?
         and not exists (select 1 from retraction r where r.gita_id = g.id)
       union all
       select ir.observed_at from imported_report ir where ir.itinerary_id = ?
     )
     select count(*) as total,
            coalesce(sum(observed_at >= ?), 0) as recent,
            max(observed_at) as last
     from report`, [itineraryId, itineraryId, since])
  return { total: row?.total ?? 0, recent: row?.recent ?? 0, lastReportAt: row?.last ?? null }
}

export async function findGita(db: Db, id: string): Promise<GitaRow | null> {
  const row = await db.get<RawGita>(`${SELECT} where g.id = ?`, [id])
  return row ? toRow(row) : null
}

export interface NewImportedReport {
  readonly id: string
  readonly itineraryId: string
  readonly observedAt: string
  readonly words: string
}

/** A report an import brought in, kept for its words. See migrations 019 and 020. */
export async function insertImportedReport(db: Db, r: NewImportedReport): Promise<void> {
  await db.run(
    `insert into imported_report (id, itinerary_id, observed_at, words)
     values (?, ?, ?, ?)`,
    [r.id, r.itineraryId, r.observedAt, r.words])
}

/**
 * Whether this exact unsigned report is already held: the same route, day and
 * words. What lets the seed add its reports to an archive that already holds
 * its routes, without adding them twice.
 */
export async function hasImportedReport(
  db: Db, r: { itineraryId: string; observedAt: string; words: string },
): Promise<boolean> {
  return (await importedReportId(db, r)) !== null
}

/** The id this exact unsigned report is held under, or null: where the seed hangs its photos. */
export async function importedReportId(
  db: Db, r: { itineraryId: string; observedAt: string; words: string },
): Promise<string | null> {
  const row = await db.get<{ id: string }>(
    `select id from imported_report
     where itinerary_id = ? and observed_at = ? and words = ?
     order by id limit 1`,
    [r.itineraryId, r.observedAt, r.words])
  return row?.id ?? null
}
