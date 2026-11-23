import type { ForeignRow } from './source.ts'
import type { NewItinerary, NewPart } from '../db/itinerary.ts'
import { activityOf } from '../domain/activities/index.ts'
import { FactError, resolveFacts, resolveAccessFacts, type Part } from '../domain/facts.ts'
import { storedProse, type ActivitySchema } from '../domain/registry.ts'
import { checkProposal, sortApproach } from '../domain/approach.ts'
import type { RowReading, Suggestion } from './reading.ts'
import {
  aspect as aspectQuantity, count, gradeSteps, metres, type Aspect, type Quantity,
} from '../domain/quantity.ts'

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

export interface Refusal {
  readonly riga: number
  readonly field: string
  readonly reason: string
  /** What was there, as it was written — the person fixing the source needs it. */
  readonly found: string
}

/**
 * The three inputs the writer needs, minus the ids only the writer can mint.
 *
 * `translate` does not invent an id: a uuid per call would make the same row
 * translate differently on a second reading, and "the same row twice is the
 * same answer" is a property this module has a test for. The run loop mints
 * ids, because it is the run loop that knows whether the row is already there.
 */
/**
 * A cell that was written, but read through a rule rather than as it stands —
 * a slash grade taken at its left side. Reported beside what was written, so
 * the person holding the source can see which values a rule chose.
 */
export interface Interpretation {
  readonly riga: number
  readonly field: string
  readonly found: string
  readonly readAs: string
}

export type NewItineraryInput = Omit<NewItinerary, 'id'>
export type NewPartInput = Omit<NewPart, 'id' | 'itineraryId'>
/** A report's own words and the day it reports. */
export interface NewImportedReportInput {
  readonly observedAt: string
  readonly words: string
}

export type Translated =
  | { readonly ok: true; readonly itinerary: NewItineraryInput
      readonly parts: readonly NewPartInput[]
      readonly reports: readonly NewImportedReportInput[]
      readonly interpretations: readonly Interpretation[]
      /** What a model noticed about the prose and nothing applied: for a person. */
      readonly suggestions: readonly Suggestion[] }
  | { readonly ok: false; readonly refusals: readonly Refusal[] }

/**
 * What the archive already holds, handed in so translation stays pure.
 *
 * Both halves are needed, and for the same reason: a translator handed only the
 * activities could not refuse a place the archive lacks, and would have to
 * either invent one or let the writer fail. Find's `parse(line, vocabulary)`
 * takes its vocabulary the same way and for the same reason.
 */
export interface Vocabulary {
  /** Foreign activity code to this archive's activity id. */
  readonly activities: Readonly<Record<string, string>>
  /** Place name to id — the only places a row may name. */
  readonly places: Readonly<Record<string, string>>
}

/**
 * The activity codes this export writes, declared rather than guessed. The
 * number is meaningless outside the source system, so nothing can derive this
 * table; somebody read the source's own documentation and wrote it down. A code
 * that is not here is refused, which is what happens to the two rows filed under
 * escursionismo and under whatever 7 was.
 */
export const ACTIVITY_CODES: Readonly<Record<string, string>> = {
  '1': 'alpinismo',
  '2': 'falesia',
}

// ---------------------------------------------------------------------------
// The shape of the export
// ---------------------------------------------------------------------------

/** Columns that mean the same thing whatever the row's activity is. */
const NAME = 'titolo'
const PLACE = 'zona'
const ACTIVITY = 'att'
const CREATED = 'data'
const REPORTS = 'relazioni'
const REPORT_DAY = 'data'
const REPORT_WORDS = 'testo'
const LAT = 'lat'
const LON = 'lon'
/** The prose section that is the walk, and the access fact that is the road. */
const APPROACH = 'avvicinamento'
const ACCESS = 'come_arrivare'
const PARKING = 'parcheggio_nota'

interface PartsMap {
  /** The column holding the list. */
  readonly from: string
  /** The column holding the source's own number for each one. */
  readonly position: string
  /** The column holding the group, where the source records one. */
  readonly group?: string
  /** Part field id to column. Every field the registry declares needs one. */
  readonly fields: Readonly<Record<string, string>>
}

interface Mapping {
  readonly schema: ActivitySchema
  /** Fact id to column, for every fact the activity does not derive. */
  readonly facts: Readonly<Record<string, string>>
  /**
   * Access-fact id to column — unlike `facts`, never required to cover every
   * id the registry declares: `access` facts are all optional by
   * construction, and a foreign archive's finer-grained fields (a distinct
   * "come arrivare" versus "da Torino" versus a parking note) usually don't
   * exist as separate source columns at all.
   */
  readonly access: Readonly<Record<string, string>>
  /** Section id to column. A column the source omits is an absence. */
  readonly sections: Readonly<Record<string, string>>
  /** The aspect and the summit, which are itinerary columns as well as facts. */
  readonly aspect: string
  readonly altMax: string
  readonly parts?: PartsMap
}

/**
 * How each activity's columns are named in the foreign file.
 *
 * This is the cost the registry does not pay for: nineteen activities differ
 * without nineteen templates, but a foreign export's column names are a fact
 * about the export, not about the activity, and nothing can derive them. Adding
 * an activity to *this importer* is an entry here; the rest of the system needs
 * none. An activity with no entry is refused by name rather than half-read.
 */
const MAPPINGS: Readonly<Record<string, Mapping>> = {
  alpinismo: {
    schema: activityOf('alpinismo'),
    facts: {
      difficolta: 'diff', dislivello: 'disl', partenza: 'q_part',
      vetta: 'q_max', esposizione: 'esp', giorni: 'gg',
    },
    access: { come_arrivare: 'accesso' },
    sections: {
      descrizione: 'descr', discesa: 'disc', note: 'note',
      avvicinamento: 'avvicinamento', materiale: 'mat',
    },
    aspect: 'esp',
    altMax: 'q_max',
    // The export carries no pitches for an alpine route, and alpinismo declares
    // its tiri optional. Nothing is lost and nothing is invented.
  },
  falesia: {
    schema: activityOf('falesia'),
    // Two of this activity's facts are derived from the vie and so appear
    // nowhere here: gradi and vie are read off the parts below.
    facts: {
      esposizione: 'esp', ombra_dalle: 'ombra', quota_base: 'q_part', avvicinamento: 'min_avv',
      // The guidebook side column. Each is read through its quantity, so a
      // value outside it is refused by name — a four-star source is not
      // rescaled to five; it has to say which scale it uses first.
      parete: 'parete', roccia: 'roccia', stagione: 'stagioni', con_la_pioggia: 'pioggia',
      per_famiglie: 'famiglie',
      bellezza: 'v_bellezza', chiodatura: 'v_chiodatura', tranquillita: 'v_tranquillita',
      comodita: 'v_comodita', voto_parcheggio: 'v_parcheggio',
    },
    access: { come_arrivare: 'accesso' },
    // `avvicinamento` is a fact (minutes, from min_avv) *and* a section (prose,
    // from the column of the same name). Two bags, one id, two different things.
    // `storia` is the source archive's Storico, drawn after the note in the crag's
    // Descrizione (see falesia.ts).
    sections: { note: 'note', storia: 'storico', avvicinamento: 'avvicinamento' },
    aspect: 'esp',
    altMax: 'q_max',
    parts: {
      from: 'vie',
      position: 'n',
      group: 'settore',
      fields: { nome: 'nome', grado: 'grado', lunghezza: 'lung' },
    },
  },
}

/**
 * The mapping is checked against the registry here, at load, the way
 * `defineActivity` checks a schema: a fact that gains a column in the registry
 * and not here would otherwise be dropped silently, and every row would import
 * and then throw on its own page. Failing at import time makes it a boot error,
 * which is where this project puts every other registry mismatch.
 */
function checkMappings(): void {
  for (const [id, m] of Object.entries(MAPPINGS)) {
    for (const def of m.schema.facts) {
      if (def.derived || def.optional) continue
      if (!m.facts[def.id]) {
        throw new Error(`${id}: the registry declares the fact "${def.id}" and no column maps to it`)
      }
    }
    for (const factId of Object.keys(m.facts)) {
      if (!m.schema.facts.some(f => f.id === factId && !f.derived)) {
        throw new Error(`${id}: a column maps to "${factId}", which the registry does not declare`)
      }
    }
    for (const accessId of Object.keys(m.access)) {
      if (!(m.schema.access ?? []).some(f => f.id === accessId)) {
        throw new Error(
          `${id}: a column maps to access "${accessId}", which the registry does not declare`)
      }
    }
    for (const sectionId of Object.keys(m.sections)) {
      const declared = storedProse([...m.schema.document, ...m.schema.rail]).has(sectionId)
      if (!declared) throw new Error(`${id}: a column maps to the prose section "${sectionId}", which the registry does not declare`)
    }
    for (const field of m.schema.parts?.fields ?? []) {
      if (m.parts && !m.parts.fields[field.id]) {
        throw new Error(`${id}: the registry declares the part field "${field.id}" and no column maps to it`)
      }
    }
  }
}

checkMappings()

// ---------------------------------------------------------------------------
// Reading a cell
// ---------------------------------------------------------------------------

type Reading<T> =
  | { readonly ok: true; readonly value: T
      /** Set when a rule, not the cell as written, gave the value: said in the report. */
      readonly readAs?: string }
  | { readonly ok: false; readonly reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nothing was filled in: absent, null, or a box containing spaces. */
function absent(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
}

/** What was there, as it was written. Quoted, so a blank box is visibly a blank box. */
function asWritten(raw: unknown): string {
  if (raw === undefined) return '(nothing)'
  return JSON.stringify(raw) ?? String(raw)
}

const DIGITS = /^\d+$/

/**
 * What a refusal says about an empty box. It reads as the rule it comes from,
 * because the person it is written for is the person holding the source file.
 */
const MISSING = 'missing: nothing was filled in, and nothing may be invented to fill it'

/**
 * One foreign cell read as the quantity the registry declares for it.
 *
 * Twenty years of web forms leave figures stored as text, so a cell of nothing
 * but digits is retried as the number it spells. That is the same figure
 * written differently, not a reading of an ambiguous value: `"circa 800"`,
 * `"800 m"` and `"8oo"` all stay refused.
 *
 * An empty cell is refused, and this is the sharpest decision in the file:
 * `resolveFacts` throws on a missing fact, and both the boot check and the page
 * renderer call it, so a route missing a fact the registry requires cannot exist
 * in this archive — it would stop a deploy and 500 its own page.
 *
 * That was once true of the grade too, and the spec's section 5 recorded the
 * cost: real routes refused for a blank column. The registry now declares a fact
 * optional where the archive may genuinely not know it, and the caller skips an
 * absent one before reaching here. What arrives here is a cell with something in
 * it, and something unreadable is still a refusal.
 */
function readCell(quantity: Quantity<unknown>, raw: unknown): Reading<unknown> {
  if (absent(raw)) {
    return { ok: false, reason: MISSING }
  }
  try {
    return { ok: true, value: quantity.parse(raw) }
  } catch (err) {
    const grade = typeof raw === 'string' ? gradeInOtherCase(quantity, raw) : undefined
    if (grade !== undefined) return { ok: true, value: grade }
    const left = typeof raw === 'string' ? gradeLeftOfSlash(quantity, raw) : undefined
    if (left !== undefined) {
      return { ok: true, value: left, readAs: `${left}, the grade left of the slash` }
    }
    const unsigned = typeof raw === 'string' ? gradeWithoutMinus(quantity, raw) : undefined
    if (unsigned !== undefined) {
      return { ok: true, value: unsigned, readAs: `${unsigned}, the grade without its minus` }
    }
    const first = typeof raw === 'string' ? gradeBeforeBrackets(quantity, raw) : undefined
    if (first !== undefined) {
      return { ok: true, value: first, readAs: `${first}, the grade before the brackets` }
    }
    if (typeof raw === 'string' && DIGITS.test(raw.trim())) {
      try {
        return { ok: true, value: quantity.parse(Number(raw.trim())) }
      } catch (retry) {
        return { ok: false, reason: (retry as Error).message }
      }
    }
    return { ok: false, reason: (err as Error).message }
  }
}

/**
 * `5C` as `5c`, `pd+` as `PD+`: the step of the cell's own scale that it spells
 * in another letter case, or undefined.
 *
 * A translation for the same reason `"800"` is 800: no two steps of one scale
 * differ only by case, so there is exactly one step it can be. Nothing else is
 * forgiven here. `7b/+` is two grades, `5+` and `4°` belong to another scale,
 * and `6c-` is no French grade; each is still refused by name.
 */
function gradeInOtherCase(quantity: Quantity<unknown>, raw: string): string | undefined {
  const system = quantity.kind.startsWith('grade:') ? quantity.kind.slice('grade:'.length) : ''
  if (system !== 'sport' && system !== 'alpine') return undefined
  const written = raw.trim().toLowerCase()
  return gradeSteps(system).find(step => step.toLowerCase() === written)
}

/**
 * `7b/+` as `7b`, `6a+/6b` as `6a+`, `AD/D` as `AD`: the grade left of the
 * slash, where it is a step of the cell's own scale, or undefined.
 *
 * This is a rule, not a translation, and it was the designer's call: a slash
 * grade spans two steps and the archive holds one per via, so something has to
 * choose, and the spec once refused the row instead. The left side is the one
 * the topo wrote first and the easier of the two. Because it is a choice, every
 * value read this way is listed in the report (`Interpretation`), so nobody
 * mistakes it for what the source said.
 */
function gradeLeftOfSlash(quantity: Quantity<unknown>, raw: string): string | undefined {
  if (!quantity.kind.startsWith('grade:')) return undefined
  const at = raw.indexOf('/')
  if (at <= 0) return undefined
  const left = raw.slice(0, at)
  try { return quantity.parse(left.trim()) as string }
  catch { return gradeInOtherCase(quantity, left) }
}

/**
 * `6c-` as `6c`: a trailing minus dropped, where what is left is a step of the
 * cell's own scale. The designer's rule, like the slash one, and reported the
 * same way. A scale whose steps carry a minus (`AD-`) reads them as written
 * before this is ever asked, so only a minus the scale does not have is dropped.
 * `5+` is not helped by anything here: its letter is missing, not extra.
 */
function gradeWithoutMinus(quantity: Quantity<unknown>, raw: string): string | undefined {
  if (!quantity.kind.startsWith('grade:')) return undefined
  const written = raw.trim()
  if (!written.endsWith('-') || written.length < 2) return undefined
  const rest = written.slice(0, -1)
  try { return quantity.parse(rest) as string }
  catch { return gradeInOtherCase(quantity, rest) }
}

/**
 * `6c+ (L2 7b)` as `6c+`: the grade written first, where what follows is in
 * brackets. A via with two pitches is graded pitch by pitch, and the archive
 * holds one grade per via; the designer's rule is the first, the one the via
 * starts with. Reported, like the slash and the minus, and worded as what was
 * done rather than why, since brackets also hold "(da confermare)".
 */
function gradeBeforeBrackets(quantity: Quantity<unknown>, raw: string): string | undefined {
  if (!quantity.kind.startsWith('grade:')) return undefined
  const m = /^([^\s(]+)\s*\(.*\)$/.exec(raw.trim())
  if (!m) return undefined
  try { return quantity.parse(m[1]) as string }
  catch { return gradeInOtherCase(quantity, m[1]!) }
}

/** An itinerary column the schema allows to be null: absent is a value here. */
function readOptionalCell(quantity: Quantity<unknown>, raw: unknown): Reading<unknown> {
  return absent(raw) ? { ok: true, value: null } : readCell(quantity, raw)
}

const DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/

/**
 * `14/09/2026` as the day it names. Unambiguous in this source — no row is
 * written the other way round, and the export's own header says
 * `14/09/2026 03:12:07` — so this is a translation and not a coin toss between
 * two conventions.
 *
 * The day has to exist. `31/02/2026` and `30/02/2026` are refused by building
 * the date and asking whether it came back as the day that was asked for,
 * which also gets February right in a leap year without a table.
 */
function readDay(raw: unknown): Reading<string> {
  if (absent(raw)) return { ok: false, reason: MISSING }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'expected a day written dd/mm/yyyy' }
  }
  const m = DAY.exec(raw.trim())
  if (!m) return { ok: false, reason: 'not a day written dd/mm/yyyy' }

  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day) {
    return { ok: false, reason: 'not a day: that month has no such date' }
  }
  return { ok: true, value: `${m[3]}-${m[2]}-${m[1]}` }
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/
/**
 * Exactly the notation this archive writes: `44°40'14"N`. No spaces, whole
 * seconds, hemisphere last.
 *
 * Converting is arithmetic, but the notations are not: `44°40.5'`, `44 40 14`,
 * `+44°40'14"` and a signed decimal with a comma are all things some export
 * somewhere writes, and each would have to be read into a different formula. A
 * reader that guesses at one of them is the "picks the likelier of two
 * readings" the spec refuses, so anything but this pattern is refused by name.
 *
 * The one place this goes past the file: the hemisphere letter is all four,
 * not the N and E the file happens to hold. Reading `N` at all means deciding
 * what the letter does, and a reader that knows N means north while refusing S
 * is not simpler — only less honest about what it already knows.
 */
const DMS = /^(\d{1,3})°(\d{1,2})'(\d{1,2})"([NSEW])$/

function readCoordinate(axis: 'lat' | 'lon', raw: unknown): Reading<number> {
  const limit = axis === 'lat' ? 90 : 180
  const bound = (value: number): Reading<number> =>
    Math.abs(value) <= limit
      ? { ok: true, value }
      : { ok: false, reason: `a ${axis === 'lat' ? 'latitude' : 'longitude'} is between -${limit} and ${limit}` }

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? bound(raw) : { ok: false, reason: 'not a number' }
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'expected a coordinate' }

  const written = raw.trim()
  if (DECIMAL.test(written)) return bound(Number(written))

  const m = DMS.exec(written)
  if (!m) {
    return { ok: false,
      reason: 'not a coordinate this archive writes: expected 44.6721 or 44°40\'14"N' }
  }
  const [degrees, minutes, seconds, hemisphere] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]!]
  if (minutes > 59 || seconds > 59) {
    return { ok: false, reason: 'not a coordinate: minutes and seconds run to 59' }
  }
  const northSouth = hemisphere === 'N' || hemisphere === 'S'
  if (northSouth !== (axis === 'lat')) {
    return { ok: false, reason: `${hemisphere} is not a hemisphere a ${axis} is in` }
  }
  const magnitude = degrees + minutes / 60 + seconds / 3600
  return bound(hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude)
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * One foreign row as this archive would hold it, or the reasons it cannot.
 *
 * Pure: no database, no filesystem, no clock it was not handed. What the
 * archive already knows arrives as `known`.
 *
 * **A refusal of one field refuses the row.** A route imported without its grade
 * because the grade was unreadable is a route that looks fully imported and is
 * not, and nothing downstream can tell the difference. The exception is a field
 * the source simply does not carry — a missing prose column, a report with no
 * snow line — which is absence rather than error.
 *
 * Every refusal it can find is returned, not the first, the way `resolveFacts`
 * and `fileFromForm` already report every problem from one attempt.
 */
/**
 * A row's prose, by this archive's section id, as the run loop sends it to a
 * model: only the boxes the row's activity maps, only those with words in.
 * Empty when there is nothing to read, or when the activity is not one this
 * import knows — `translate` refuses that row anyway.
 */
export function proseOf(row: ForeignRow, known: Vocabulary): Record<string, string> {
  const written = row[ACTIVITY]
  const code = typeof written === 'number' || typeof written === 'string' ? String(written).trim() : ''
  const activityId = known.activities[code]
  const mapping = activityId === undefined ? undefined : MAPPINGS[activityId]
  const boxes: Record<string, string> = {}
  for (const [sectionId, column] of Object.entries(mapping?.sections ?? {})) {
    const text = row[column]
    if (typeof text === 'string' && text.trim() !== '') boxes[sectionId] = text
  }
  return boxes
}

/**
 * One foreign row, read against what the archive holds.
 *
 * `reading` is what a model said about the row's prose, asked for by the run
 * loop and handed in, so that this stays arithmetic: it decides where an
 * approach's road ends only if `checkProposal` accepts it, and everything else
 * it says comes back as suggestions, applied nowhere.
 */
export function translate(row: ForeignRow, known: Vocabulary, reading?: RowReading | null): Translated {
  const refusals: Refusal[] = []
  const refuse = (field: string, reason: string, found: unknown): void => {
    // One column read twice — `esp` is both a fact and an itinerary column —
    // must not be reported twice.
    if (refusals.some(r => r.field === field && r.reason === reason)) return
    refusals.push({ riga: row.riga, field, reason, found: asWritten(found) })
  }
  const interpretations: Interpretation[] = []
  const noteIf = (field: string, read: Reading<unknown>, found: unknown): void => {
    if (read.ok && read.readAs !== undefined) {
      interpretations.push({ riga: row.riga, field, found: asWritten(found), readAs: read.readAs })
    }
  }

  // --- the name
  const writtenName = row[NAME]
  const name = typeof writtenName === 'string' ? writtenName.trim() : ''
  if (name === '') {
    refuse(NAME, 'a route with no name cannot be found, linked to or told apart', writtenName)
  }

  // --- the place
  const writtenPlace = row[PLACE]
  const placeId = typeof writtenPlace === 'string'
    ? known.places[writtenPlace.trim()] : undefined
  if (absent(writtenPlace)) {
    refuse(PLACE, 'missing: a route has to be somewhere', writtenPlace)
  } else if (placeId === undefined) {
    refuse(PLACE, 'no place in this archive has that name, and inventing a place is inventing geography',
      writtenPlace)
  }

  // --- the activity
  const writtenActivity = row[ACTIVITY]
  const code = typeof writtenActivity === 'number' || typeof writtenActivity === 'string'
    ? String(writtenActivity).trim() : ''
  const activityId = code === '' ? undefined : known.activities[code]
  const mapping = activityId === undefined ? undefined : MAPPINGS[activityId]
  if (activityId === undefined) {
    refuse(ACTIVITY, 'no activity code in this import is that number', writtenActivity)
  } else if (!mapping) {
    refuse(ACTIVITY, `this import can read no columns for the activity "${activityId}"`,
      writtenActivity)
  }

  // --- the day the sheet was written
  const created = readDay(row[CREATED])
  const createdDay = created.ok ? created.value : null
  if (!created.ok) refuse(CREATED, created.reason, row[CREATED])

  // Everything below is read out of columns only the activity can name, so
  // there is nothing further to say about a row whose activity is unreadable.
  if (!mapping) return { ok: false, refusals }

  const schema = mapping.schema

  // --- the header facts
  const facts: Record<string, unknown> = {}
  for (const def of schema.facts) {
    if (def.derived) continue          // read off the parts, below
    const column = mapping.facts[def.id]
    if (column === undefined) continue // an optional fact this import format has no column for

    // A fact the registry declares optional is one the archive may genuinely
    // not know, so a blank cell leaves it out rather than refusing the route.
    // A cell with something unreadable in it is still a refusal: nobody wrote
    // it and somebody wrote something nothing can read are different things.
    if (def.optional && absent(row[column])) continue

    const read = readCell(def.quantity, row[column])
    noteIf(column, read, row[column])
    if (read.ok) facts[def.id] = read.value
    else refuse(column, read.reason, row[column])
  }

  // --- the access facts — same shape, but a column may legitimately not
  // exist at all: `checkMappings` never requires one, since every access
  // fact is optional by construction.
  for (const def of schema.access ?? []) {
    const column = mapping.access[def.id]
    if (column === undefined) continue        // this activity's import never carries it
    if (absent(row[column])) continue          // optional; a blank cell is fine

    const read = readCell(def.quantity, row[column])
    if (read.ok) facts[def.id] = read.value
    else refuse(column, read.reason, row[column])
  }

  // --- the two facts that are also columns of their own
  const readAspect = readOptionalCell(aspectQuantity, row[mapping.aspect])
  if (!readAspect.ok) refuse(mapping.aspect, readAspect.reason, row[mapping.aspect])
  const readAltMax = readOptionalCell(metres, row[mapping.altMax])
  if (!readAltMax.ok) refuse(mapping.altMax, readAltMax.reason, row[mapping.altMax])

  // --- where it is
  const writtenLat = row[LAT]
  const writtenLon = row[LON]
  let lat: number | null = null
  let lon: number | null = null
  if (absent(writtenLat) && absent(writtenLon)) {
    // Accepted without coordinates: the schema allows null, the page renders,
    // and only the map and `near` lose it.
  } else if (absent(writtenLat) || absent(writtenLon)) {
    const missing = absent(writtenLat) ? LAT : LON
    refuse(missing, 'half a coordinate is not a point',
      absent(writtenLat) ? writtenLat : writtenLon)
  } else {
    const readLat = readCoordinate('lat', writtenLat)
    const readLon = readCoordinate('lon', writtenLon)
    if (readLat.ok) lat = readLat.value
    else refuse(LAT, readLat.reason, writtenLat)
    if (readLon.ok) lon = readLon.value
    else refuse(LON, readLon.reason, writtenLon)
  }

  // --- the prose
  const sections: Record<string, string> = {}
  for (const [sectionId, column] of Object.entries(mapping.sections)) {
    const written = row[column]
    if (absent(written)) continue                 // a column nobody filled in
    if (typeof written !== 'string') {
      refuse(column, 'expected written prose', written)
      continue
    }
    // Kept exactly as the web form left it, markup and all. The renderer
    // escapes it, so a `<b>` reaches the page as characters rather than
    // becoming markup; stripping it here would be rewriting a contributor's
    // prose on a guess about what the tag was for.
    sections[sectionId] = written
  }

  // --- the road, out of the walk. A source's "avvicinamento" box often starts
  // with the drive and the parking, which this archive keeps in `Accesso e
  // parcheggio`: the source's section names are where its authors typed, not
  // what they typed. Whole sentences move, untouched, and the report says so,
  // so whoever holds the source can see what was chosen and by what. A model's
  // reading decides where it passes `checkProposal`; the word rule otherwise
  // (src/domain/approach.ts, a design study).
  const walkColumn = mapping.sections[APPROACH]
  const accessColumn = mapping.access[ACCESS] ?? ACCESS
  const declares = (id: string) => (schema.access ?? []).some(f => f.id === id)
  let appliedFromApproach = false
  if (walkColumn !== undefined && sections[APPROACH] !== undefined && declares(ACCESS)) {
    const written = sections[APPROACH]
    const proposed = reading?.sentences
      .filter(s => s.from === APPROACH)
      .map(s => ({ text: s.text, to: s.to === 'road' || s.to === 'parking' ? s.to : 'walk' as const }))
    const checked = proposed && proposed.length > 0 ? checkProposal(written, proposed) : null
    const sorted = checked ?? sortApproach(written)
    const by = checked ? 'the model’s reading, checked against the text' : 'the word rule'
    // Parking goes to its own box where the activity has one; otherwise it
    // stays with the road, as the rule leaves it.
    const toParking = sorted.parking !== null && declares(PARKING)
    const road = [sorted.access, toParking ? null : sorted.parking].filter(s => s !== null).join(' ')
    if (road !== '' || toParking) {
      appliedFromApproach = checked !== null
      const add = (id: string, words: string) => {
        const already = typeof facts[id] === 'string' ? facts[id] as string : null
        facts[id] = already === null ? words : `${already} ${words}`
      }
      if (road !== '') add(ACCESS, road)
      if (toParking) add(PARKING, sorted.parking!)
      if (sorted.approach === null) delete sections[APPROACH]
      else sections[APPROACH] = sorted.approach
      const moved = [
        road !== '' ? `${asWritten(road)} as ${accessColumn}` : null,
        toParking ? `${asWritten(sorted.parking)} as ${PARKING}` : null,
      ].filter(s => s !== null).join(', ')
      interpretations.push({
        riga: row.riga, field: walkColumn, found: asWritten(written),
        readAs: `${moved}, ${sorted.approach === null ? `nothing on foot left as ${walkColumn}` : `the rest as ${walkColumn}`}`
          + ` — by ${by}`,
      })
    }
  }

  // --- what else the reading noticed, for a person: never applied. The road
  // and the parking it moved above are not repeated; a sentence of the walk it
  // calls a walk, or any sentence it leaves where it was typed, is nothing to say.
  // A sentence that is not in the box as written is not repeated either: the
  // person reading the report has to be able to find it in the source.
  const suggestions: Suggestion[] = []
  for (const s of reading?.sentences ?? []) {
    // A note is part of what describes the route (a crag's note is its whole
    // Descrizione), so a note sentence "read as presentation" is one left where
    // it was typed.
    if (s.to === 'here' || (s.to === 'presentation' && s.from === 'note')) continue
    if (s.from === APPROACH && (s.to === 'walk' || (appliedFromApproach && (s.to === 'road' || s.to === 'parking')))) continue
    const field = mapping.sections[s.from]
    const original = field === undefined ? undefined : row[field]
    if (field === undefined || typeof original !== 'string' || !original.includes(s.text.trim())) continue
    suggestions.push({ riga: row.riga, field, sentence: s.text.trim(), to: s.to,
      ...(s.fact !== undefined && s.to === 'fact' ? { fact: s.fact } : {}) })
  }

  // --- the parts
  const parts: NewPartInput[] = []
  if (mapping.parts) {
    const map = mapping.parts
    const written = row[map.from]
    const list = Array.isArray(written) ? written : []
    if (!absent(written) && !Array.isArray(written)) {
      refuse(map.from, 'expected a list of parts', written)
    } else if (list.length === 0 && schema.parts && !schema.parts.optional) {
      refuse(map.from,
        'this activity derives header facts from its parts, and this row lists none',
        written)
    }

    list.forEach((one, i) => {
      // The part's place in the list, counted from 1, because that is how a
      // person opening the file counts.
      const where = `${map.from}[${i + 1}]`
      if (!isRecord(one)) {
        refuse(where, 'expected one part', one)
        return
      }

      // The source numbers its own vie, and that number is the position. A via
      // with no readable number is refused rather than renumbered: closing a gap
      // in somebody else's numbering is inventing where a via sits.
      const position = readCell(count, one[map.position])
      if (!position.ok) refuse(`${where}.${map.position}`, position.reason, one[map.position])

      let group: string | null = null
      if (map.group !== undefined && !absent(one[map.group])) {
        if (typeof one[map.group] === 'string') group = (one[map.group] as string).trim()
        else refuse(`${where}.${map.group}`, 'expected a name', one[map.group])
      }

      const fields: Record<string, unknown> = {}
      for (const def of schema.parts?.fields ?? []) {
        const column = map.fields[def.id]!
        // The rule header facts follow: optional and blank is absent, not
        // refused; optional and unreadable is still refused by name.
        if (def.optional && absent(one[column])) continue
        const read = readCell(def.quantity, one[column])
        noteIf(`${where}.${column}`, read, one[column])
        if (read.ok) fields[def.id] = read.value
        else refuse(`${where}.${column}`, read.reason, one[column])
      }

      if (position.ok) {
        parts.push({ group, position: position.value as number, fields })
      }
    })
  }

  // --- the reports
  const keptReports: NewImportedReportInput[] = []
  const writtenReports = row[REPORTS]
  if (!absent(writtenReports) && !Array.isArray(writtenReports)) {
    refuse(REPORTS, 'expected a list of reports', writtenReports)
  }
  const reports = Array.isArray(writtenReports) ? writtenReports : []
  reports.forEach((one, i) => {
    const where = `${REPORTS}[${i + 1}]`
    if (!isRecord(one)) {
      refuse(where, 'expected a report', one)
      return
    }

    const day = readDay(one[REPORT_DAY])
    if (!day.ok) refuse(`${where}.${REPORT_DAY}`, day.reason, one[REPORT_DAY])

    // A report is its words. The export also carries a verdict (giudizio)
    // and a measure or two; this archive keeps neither, so those columns are
    // not read, the way any column nothing maps is not read. A report with
    // no words is skipped: it says nothing this archive keeps, and refusing
    // the whole route over it would lose the route for a field nobody uses.
    const writtenWords = one[REPORT_WORDS]
    if (!absent(writtenWords) && typeof writtenWords !== 'string') {
      refuse(`${where}.${REPORT_WORDS}`, 'expected written words', writtenWords)
    }
    const words = typeof writtenWords === 'string' && writtenWords.trim() !== ''
      ? writtenWords.trim() : null

    if (day.ok && words !== null) {
      keptReports.push({ observedAt: day.value, words })
    }
  })

  // --- the last question: would the archive hold this?
  //
  // `resolveFacts` is what the boot check and the page renderer call, and until
  // now nothing ran it at write time outside the seed — the spec predicted that
  // a bad facts bag would be accepted and fail on a page. Running it on what
  // this row *makes* closes that: a row that translates is a row that renders,
  // and Task 3 does not have to ask again. It reports in fact ids, so each
  // problem is named back to the column the person has to go and fix.
  //
  // Nothing in this archive reaches it — every column is read against the same
  // registry above. It is here for the reading the column checks cannot do: an
  // activity whose parts are optional and whose facts are derived from them
  // would pass every check above with no parts and still have nothing to derive
  // from. Neither of the two activities is shaped that way; a nineteenth could
  // be.
  if (refusals.length === 0) {
    const resolvable: Part[] = parts.map((p, i) => ({ id: `p${i + 1}`, ...p }))
    try {
      resolveFacts(schema, facts, resolvable)
    } catch (err) {
      const problems = err instanceof FactError ? err.problems : [(err as Error).message]
      for (const problem of problems) {
        const factId = problem.split(':')[0]!.trim()
        const column = mapping.facts[factId]
        refuse(column ?? factId, `the registry refuses what this row makes — ${problem}`,
          column === undefined ? undefined : row[column])
      }
    }
  }

  if (refusals.length === 0) {
    const resolvable: Part[] = parts.map((p, i) => ({ id: `p${i + 1}`, ...p }))
    try {
      resolveAccessFacts(schema, facts, resolvable)
    } catch (err) {
      const problems = err instanceof FactError ? err.problems : [(err as Error).message]
      for (const problem of problems) {
        const factId = problem.split(':')[0]!.trim()
        const column = mapping.access[factId]
        refuse(column ?? factId, `the registry refuses what this row makes — ${problem}`,
          column === undefined ? undefined : row[column])
      }
    }
  }

  if (refusals.length > 0) return { ok: false, refusals }

  // Nothing was refused, so every reading above succeeded. These assertions are
  // the type system's, not a second opinion about the data.
  return {
    ok: true,
    itinerary: {
      activity: schema.id,
      placeId: placeId!,
      name,
      lat,
      lon,
      // No foreign column names a parking point yet; nothing here is asked to
      // read one, so this is absence, not a guess.
      parkingLat: null,
      parkingLon: null,
      aspect: readAspect.ok ? (readAspect.value as Aspect | null) : null,
      altMax: readAltMax.ok ? (readAltMax.value as number | null) : null,
      facts,
      sections,
      // The source knows a day; the column wants an ISO-8601 instant. The start
      // of that day in UTC is the only instant a day names without adding
      // information nobody recorded.
      created: `${createdDay!}T00:00:00.000Z`,
    },
    parts,
    reports: keptReports,
    interpretations,
    suggestions,
  }
}
