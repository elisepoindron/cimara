import type { Db } from '../db/open.ts'
import { findPlaceByName } from '../db/place.ts'
import {
  findItineraryByNameInPlace, insertItinerary, insertPart, setGradeBounds,
} from '../db/itinerary.ts'
import { activityOf } from '../domain/activities/index.ts'
import { gradeBoundsOf, type Part } from '../domain/facts.ts'
import { readSource, type ForeignRow } from './source.ts'
import { insertImportedReport } from '../db/gita.ts'
import {
  ACTIVITY_CODES, proseOf, translate, type Interpretation, type Refusal, type Translated, type Vocabulary,
} from './translate.ts'
import type { ReadRow, RowReading, Suggestion } from './reading.ts'

/**
 * A row this archive already holds. Named rather than counted, because the
 * decision behind the skip is one a person may want to look at — see
 * "Two of the same name in the same place", below.
 */
export interface Present {
  readonly riga: number
  readonly name: string
  /** The place as the source wrote it: there are two Balma Scura, and this says which. */
  readonly place: string
  /** The route the row was taken to be. */
  readonly itineraryId: string
}

export interface ImportResult {
  readonly written: number
  /**
   * The rows already present — an import re-run, or a row naming something the
   * seed put there first.
   *
   * The plan asked for a count. A count cannot be acted on: "1 skipped" does
   * not say *which* route was left alone, and that is the one number in this
   * report a person might want to disagree with. `skipped.length` is still the
   * count, and the report prints it as one.
   */
  readonly skipped: readonly Present[]
  /** Every reason, from every row. One row may produce several. */
  readonly refused: readonly Refusal[]
  /** Values in rows that were written, read through a rule rather than as written. */
  readonly interpreted: readonly Interpretation[]
  /** What a model noticed in rows that were written, applied nowhere: for a person to look at. */
  readonly suggested: readonly Suggestion[]
  /** How many rows a model was asked about, and how many of those it gave no reading for. */
  readonly reading: { readonly asked: number; readonly unread: number } | null
}

/**
 * The column naming the place, and what kind of place it names.
 *
 * Declared, not derived, exactly as `ACTIVITY_CODES` is: `zona` holds a comune
 * in this export, and somebody read the source to know that. It matters because
 * place names are only unique within a kind — this archive holds a comune
 * called Torino and a provincia called TO under a regione called Piemonte — so
 * a lookup by name alone would let a row reading `zona: "Piemonte"` file a
 * route under a region. A different export whose `zona` is a valley needs a
 * different constant here and no other change.
 */
const PLACE = 'zona'
const PLACE_KIND = 'comune'

/**
 * What the archive already holds, for the places this file actually names.
 *
 * Only the names in the export are looked up, so an archive of 8,000 comuni is
 * not loaded to import twenty-six rows. A name with no place is simply absent
 * from the table, and `translate` refuses that row by name: inventing a place
 * is inventing geography.
 *
 * Known limit, not fixed here: `findPlaceByName` returns the first place of
 * that name and kind, and Italy does have comuni that share a name across
 * provinces. Telling those apart needs a column the `zona` field does not
 * carry — it holds a name and nothing else — so no reader of this export could
 * resolve it, and a repository function that refused the ambiguity would only
 * move the refusal, not answer it.
 */
async function vocabularyFor(db: Db, rows: readonly ForeignRow[]): Promise<Vocabulary> {
  const places: Record<string, string> = {}

  for (const row of rows) {
    const written = row[PLACE]
    if (typeof written !== 'string') continue
    const name = written.trim()
    if (name === '' || name in places) continue
    const place = await findPlaceByName(db, name, PLACE_KIND)
    if (place) places[name] = place.id
  }

  return { activities: ACTIVITY_CODES, places }
}

/**
 * The field a write failure is reported against.
 *
 * A refusal from `translate` names the column it was reading. A failure from
 * the archive itself names no column this file can know: the message is
 * SQLite's, and deciding which of a row's columns a constraint was about would
 * be the same guess the project refuses everywhere else. So it names the row,
 * by the column that identifies it, and repeats the archive's own words.
 */
const NAME = 'titolo'

/**
 * One translated row, written whole or not at all.
 *
 * `db.tx` per row, never around the loop: one unwritable row must not take the
 * import with it, and a row that fails halfway must not leave a route with some
 * of its vie and none of its reports. There is nothing downstream that could
 * tell such a route from a complete one.
 */
async function write(db: Db, t: Extract<Translated, { ok: true }>): Promise<void> {
  await db.tx(async () => {
    const id = crypto.randomUUID()
    await insertItinerary(db, { id, ...t.itinerary })

    const parts: Part[] = t.parts.map(p => ({ ...p, id: crypto.randomUUID() }))
    for (const part of parts) {
      await insertPart(db, {
        id: part.id, itineraryId: id, group: part.group,
        position: part.position, fields: part.fields,
      })
    }

    // After the parts, because a crag's range is derived from them — the same
    // order, and for the same reason, as the seed.
    await setGradeBounds(db, id,
      gradeBoundsOf(activityOf(t.itinerary.activity), t.itinerary.facts, parts))

    for (const r of t.reports) {
      await insertImportedReport(db, { id: crypto.randomUUID(), itineraryId: id, ...r })
    }
  })
}

/**
 * Every row of a foreign export, written or refused by name.
 *
 * **Idempotent by natural key.** A route is the same route when its name and
 * its place match, so a second run writes nothing and refuses nothing new. The
 * key is `findItineraryByNameInPlace`, which this project did not have before:
 * `findItineraryByName` matches on name alone, and the export holds a Balma
 * Scura in Crissolo and another in Bussoleno — two different crags an hour
 * apart. Keyed by name, the second would have been skipped as "already there",
 * and two real crags would have become one with nothing logged anywhere. That
 * is the finding the archive spec predicted, confirmed, and fixed.
 *
 * **Two of the same name in the same place.** The pair is the sharpest key any
 * column in this export supports, and it is still not sharp enough: a comune
 * can genuinely hold two routes called Canale Nord, and nothing in the file
 * says whether the second row is one of them or the first row exported twice.
 *
 * It is skipped, and the skip is named in the report. The reasoning, since
 * neither answer is free:
 *
 *   - Writing both is what makes a re-run duplicate the archive, and this
 *     importer is meant to be safe to run twice. Worse, the duplicate is
 *     invisible: two identical routes look exactly like the one legitimate case
 *     this rule is for.
 *   - Writing *onto* the existing route — filling in what it lacks — is the one
 *     answer that must never be taken. That is the silent merge: one route
 *     wearing another's vie, with no error and no way back.
 *   - Refusing the row would make the second run of a clean import fail
 *     wholesale, since after the first run every row matches something.
 *
 * So: nothing is written, nothing is overwritten, and the row is reported by
 * riga and by the route it was taken to be, which is the only outcome a person
 * can check. Telling the two cases apart needs the source's own identifier
 * carried into this archive — `id_itin` is right there in the export — and that
 * is a column and a migration, which is a decision about what this archive
 * stores rather than one an importer may make alone.
 */
export async function importRows(
  db: Db, rows: readonly ForeignRow[], read?: ReadRow,
): Promise<ImportResult> {
  const known = await vocabularyFor(db, rows)
  const skipped: Present[] = []
  const refused: Refusal[] = []
  const interpreted: Interpretation[] = []
  const suggested: Suggestion[] = []
  let written = 0
  let asked = 0
  let unread = 0

  for (const row of rows) {
    // A row that is refused, or already held, is never sent: translating it
    // first without a reading says which, and costs nothing.
    const plain = translate(row, known)
    if (!plain.ok) {
      refused.push(...plain.refusals)
      continue
    }

    const existing = await findItineraryByNameInPlace(db, plain.itinerary.name, plain.itinerary.placeId)

    // Only then is the model asked, once per row; whatever goes wrong there,
    // the row is still read by the rule — a reading is help, never a condition.
    let t = plain
    const boxes = proseOf(row, known)
    if (!existing && read && Object.keys(boxes).length > 0) {
      asked++
      let reading: RowReading | null = null
      try { reading = await read(boxes) } catch { reading = null }
      if (reading === null) unread++
      else {
        const withReading = translate(row, known, reading)
        if (withReading.ok) t = withReading
      }
    }

    if (existing) {
      skipped.push({
        riga: row.riga, name: t.itinerary.name,
        place: String(row[PLACE] ?? '').trim(), itineraryId: existing.id,
      })
      continue
    }

    try {
      await write(db, t)
      written++
      interpreted.push(...t.interpretations)
      suggested.push(...t.suggestions)
    } catch (err) {
      // The row rolled back whole. Every other row is untouched, which is why
      // this is caught here and not thrown: never stop at the first bad row.
      refused.push({
        riga: row.riga, field: NAME, found: JSON.stringify(t.itinerary.name),
        reason: `the archive refused this row: ${(err as Error).message}`,
      })
    }
  }

  return { written, skipped, refused, interpreted, suggested, reading: read ? { asked, unread } : null }
}

/** The same, reading the export off disk. */
export async function runImport(db: Db, path: string, read?: ReadRow): Promise<ImportResult> {
  return importRows(db, await readSource(path), read)
}
