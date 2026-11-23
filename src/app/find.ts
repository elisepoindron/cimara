import type { Db } from '../db/open.ts'
import { byId, partsOf } from '../db/itinerary.ts'
import { reportStatsFor } from '../db/gita.ts'
import { ancestorsOf, placesNamed, type PlaceRow } from '../db/place.ts'
import { favoriteIdsOf } from '../db/favorite.ts'
import { countItineraries, placeCentre, searchItineraries, vocabularyOf, type Box, type CandidateRow } from '../db/search.ts'
import { lineOf, NEARBY_KM, parse, type Constraint, type Vocabulary } from '../domain/find/constraints.ts'
import { ACTIVITIES } from '../domain/activities/index.ts'
import { dryFor, rank, type Candidate, type Ranked } from '../domain/find/rank.ts'
import { distanceM } from '../domain/geo.ts'
import { weatherFor } from './weather.ts'
import type { FetchWeather } from './weather.ts'
import { weatherSpot } from '../domain/weather.ts'
import { activityOf } from '../domain/activities/index.ts'
import { rowCellsOf, type RowSlot } from '../domain/row-facts.ts'

/**
 * How many routes are graded and ranked. Grading costs one query per route —
 * it reads that route's evidence — so the archive is narrowed in SQL and only
 * the head of it is priced. The count above the list is the size of the whole
 * answer, not of this page, which is why it is counted separately.
 */
export const SHOWN = 20

/**
 * How many routes are graded before the best of them are shown.
 *
 * Grading costs a query, so not everything can be graded — which makes the
 * shortlist's own ordering load-bearing: whatever SQL puts first is all the
 * ranking will ever see. `searchItineraries` orders it by the cheapest honest
 * proxy for the question asked, and this is how much of that head is then
 * weighed properly. Three times what is shown, so the ranking has something to
 * choose between rather than merely sorting what it was handed.
 */
export const SHORTLIST = 60

/**
 * How many routes the map gets a pin for. The map holds every route the
 * question matches, not only the page beside it, so this is the one bound on
 * what a page carries; past it the map shows the most recently reported.
 */
export const PIN_MAX = 2000

/** Where in the answer the visitor is looking: the map's view and the page of the list. */
export interface FindWhere {
  /** The map's view. Absent, the list is the whole answer. */
  readonly view?: Box | null
  /** From 1. Clamped to the pages that exist. */
  readonly page?: number
}

/** A route on Find's map: every match of the question, whatever page the list is on. */
export interface FoundPoint {
  readonly id: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly activity: string
  /** The place's own name, for the card of a pin that is not on the page. */
  readonly placeName: string
}

export interface FindResult {
  readonly constraints: readonly Constraint[]
  readonly rows: readonly FoundRow[]
  /** Every route that matched — inside the view, when there is one — which is not the same as every route shown. */
  readonly total: number
  /**
   * Every route that matched with no view: what "fuori dalla carta" is counted
   * against. Null without a view, and for a dry question, whose count is of the
   * shortlist that passed rather than of the archive.
   */
  readonly totalAll: number | null
  /** The page shown, from 1, and how many there are. */
  readonly page: number
  readonly pages: number
  /** Every match of the question, located, for the map: the page beside it does not narrow it. */
  readonly points: readonly FoundPoint[]
  /** What Find did to the line before it found anything, so the page can say so. */
  readonly reading: Reading
}

/**
 * Everything Find changed about the question on its way to an answer. Each one
 * is said on screen: a visitor who cannot see that their question was reread
 * will trust the answer to a different one.
 */
export interface Reading {
  /** The line as the model rewrote it, where the typed one found nothing and the rewrite found something. */
  readonly rewritten: string | null
  /** Words nothing could read, set aside because keeping them left nothing to show. */
  readonly ignored: string | null
}

const AS_TYPED: Reading = { rewritten: null, ignored: null }

/**
 * The seam to the model that rewrites a line the parser could not read. It is
 * handed the vocabulary to write in and returns one line in it, or null. The
 * real one lives in `ai-client.ts`; a test passes a fake, and no key means null
 * and Find answers from the parser alone.
 */
export type RewriteLine = (input: RewriteInput) => Promise<string | null>

export interface RewriteInput {
  readonly line: string
  /** The activities, as the parser reads them. */
  readonly activities: readonly string[]
  /** The fact phrases the registry declares, as the parser reads them. */
  readonly phrases: readonly string[]
}


export interface FoundRow {
  readonly ranked: Ranked
  /** "CN Crissolo" — the province and the comune, as the design's meta line sets it. */
  readonly where: string
  /** The activity's id, so the page can tell a list of one activity from a mixed one. */
  readonly activity: string
  /** The facts line, one slot per item the activity's `row` declares. */
  readonly cells: readonly RowSlot[]
  /** Whether the signed-in visitor has starred this route. False for a
   * signed-out visitor — there is no favorite to have. */
  readonly isFavorite: boolean
}

/**
 * Find: parse the line against what the archive holds, narrow to a set, grade
 * what survives, and rank it.
 *
 * The four halves each do one thing and this is the only place they meet. The
 * parser never sees the database, the search never decides anything, the engine
 * never ranks, and the ranking never queries.
 */
const DAY_MS = 24 * 60 * 60 * 1000

export async function find(
  db: Db, line: string, now: Date = new Date(), accountId?: string,
  fetchWeather: FetchWeather | null = null, rewrite: RewriteLine | null = null,
  where: FindWhere = {},
): Promise<FindResult> {
  const vocabulary = await vocabularyOf(db)
  // Understood without the view: a line is reread when it finds nothing
  // anywhere, never because the visitor zoomed into an empty valley.
  const { constraints, reading } = await understand(db, line, vocabulary, rewrite)
  const view = where.view ?? undefined

  // The centre is resolved first because the shortlist is ordered by it: asking
  // for routes near a place and then shortlisting by name would rank sixty
  // alphabetically-first routes and call the result an answer.
  const near = constraints.find(c => c.kind === 'near')
  const centre = near ? await placeCentre(db, near.placeId) : null
  const asked = constraints.filter(c => c.kind === 'dry')

  const [counted, countedAll] = await Promise.all([
    countItineraries(db, constraints, view),
    view && asked.length === 0 ? countItineraries(db, constraints) : Promise.resolve(null),
  ])

  // The SQL is read as deep as the page needs. Its first SHORTLIST rows are
  // counted and ranked; whatever follows keeps the SQL's own order, so every
  // page is a slice of one sequence and no route is on two pages, or none.
  // A dry question stops at the shortlist, so it never reads deeper.
  const wanted = Math.max(1, Math.floor(where.page ?? 1))
  const deepest = asked.length > 0 ? 1 : Math.min(wanted, Math.ceil(counted / SHOWN))
  const head = await searchItineraries(db, constraints, view, {
    centre, limit: Math.max(SHORTLIST, deepest * SHOWN),
  })
  const short = head.slice(0, SHORTLIST)
  const tail = head.slice(SHORTLIST)

  // Counted one at a time: how many reports each route has, how many inside its
  // activity's window, and the day of the newest. Nothing is graded.
  const candidateOf = async (row: CandidateRow): Promise<Candidate> => {
    const since = new Date(now.getTime() - activityOf(row.activity).current.days * DAY_MS)
      .toISOString().slice(0, 10)
    const stats = await reportStatsFor(db, row.id, since)
    return {
      id: row.id, name: row.name, lat: row.lat, lon: row.lon,
      gradeMin: row.gradeMin, gradeMax: row.gradeMax, gradeScale: row.gradeScale,
      reports: stats.total, recent: stats.recent, lastReportAt: stats.lastReportAt,
    }
  }
  const candidates: Candidate[] = []
  for (const row of short) candidates.push(await candidateOf(row))

  // A dry spell is weather, not stored, so it holds the shortlist rather than
  // the query; the count is then of what passed, which the shortlist caps. It
  // is read off the same cached weather the route page draws, asked at the
  // same altitude so the two share a row, refreshed in the background when
  // stale; a route never fetched answers no until its first fetch lands.
  const held: Candidate[] = []
  const spotOf = new Map(short.map(r => [r.id, weatherSpot(r)]))
  for (const candidate of candidates) {
    let holds = true
    for (const a of asked) {
      if (a.kind === 'dry') {
        const spot = spotOf.get(candidate.id) ?? null
        const weather = spot !== null && fetchWeather
          ? await weatherFor(db, spot.lat, spot.lon, spot.altitudeM, now, fetchWeather)
          : null
        holds &&= dryFor(weather, a.days)
      }
    }
    if (holds) held.push(candidate)
  }
  const ranked = rank(held, constraints, { now, centre })
  const meta = new Map(head.map(r => [r.id, r]))

  const total = asked.length > 0 ? held.length : counted
  const pages = Math.max(1, Math.ceil(total / SHOWN))
  const page = Math.min(wanted, pages)
  const from = (page - 1) * SHOWN

  // The page: the ranked head, then the SQL's order. A row past the head is
  // counted only when it is on the page — never the whole depth read.
  const sequence: (Ranked | CandidateRow)[] = asked.length > 0 ? [...ranked] : [...ranked, ...tail]
  const onPage = await Promise.all(sequence.slice(from, from + SHOWN).map(async r =>
    'candidate' in r ? r : { candidate: await candidateOf(r), score: 0, why: '' }))

  // Sliced before shaping: the parts a facts line needs cost one read per row,
  // so only the rows that will be shown pay it — never the sixty-route shortlist.
  const shown = await Promise.all(onPage.map(async r => {
    const row = meta.get(r.candidate.id)!
    const km = centre && r.candidate.lat !== null && r.candidate.lon !== null
      ? distanceM({ lat: r.candidate.lat, lon: r.candidate.lon }, centre) / 1000
      : null
    return {
      ranked: r,
      activity: row.activity,
      where: await whereOf(db, row.placeId, row.placeName),
      cells: rowCellsOf(activityOf(row.activity), row.facts, await partsOf(db, row.id), km),
    }
  }))
  // One query for the whole page, not one per row.
  const favorited = accountId
    ? await favoriteIdsOf(db, accountId, shown.map(r => r.ranked.candidate.id))
    : new Set<string>()

  // The map's pins: every match of the question, whatever the view and the page.
  const points: FoundPoint[] = []
  for (const r of await searchItineraries(db, constraints, undefined, { limit: PIN_MAX })) {
    if (r.lat === null || r.lon === null) continue
    points.push({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, activity: r.activity, placeName: r.placeName })
  }

  return {
    constraints, total, totalAll: countedAll, page, pages, points, reading,
    rows: shown.map(r => ({ ...r, isFavorite: favorited.has(r.ranked.candidate.id) })),
  }
}

/** The words nothing in the archive could read, or null. */
function unread(constraints: readonly Constraint[]): string | null {
  const name = constraints.find(c => c.kind === 'name')
  return name?.kind === 'name' ? name.text : null
}

/**
 * The question Find will answer, which is the one typed wherever that finds
 * anything. A line that finds nothing gets more tries, in order, each cheaper
 * and surer than the next:
 *
 *  1. a town's name read as part of a route's instead — with every comune in
 *     the archive, `Canale SO e Cresta S` names Canale, in the Roero, and is a
 *     gully up the Meidassa;
 *  2. a town that holds nothing asked as a distance around it (`aroundThePlace`),
 *     and a `vicino a` whose thirty kilometres hold nothing asked wider;
 *  3. a town's name forgiven one slip — `Torine` — and asked again, the same
 *     two ways;
 *  4. the model rewrites it into the archive's own phrasing, where a model is
 *     configured — any language, free wording, a too-narrow place;
 *  5. without a model, or where its rewrite found nothing either, the words the
 *     parser could not read are set aside, if something else was understood —
 *     and a `vicino a` then widened, as in 2.
 *
 * Each try that changes the question is recorded in the `Reading`, so the page
 * says what was changed; the first only moves words into the name slot, where
 * the sentence already shows them. A try that still finds nothing is not kept:
 * an empty list is better shown against the question the visitor asked than
 * against one Find made up.
 */
async function understand(
  db: Db, line: string, vocabulary: Vocabulary, rewrite: RewriteLine | null,
): Promise<{ constraints: readonly Constraint[]; reading: Reading }> {
  const typed = parse(line, vocabulary)
  if (await countItineraries(db, typed) > 0) return { constraints: typed, reading: AS_TYPED }

  const named = placesAsName(typed)
  if (named && await countItineraries(db, named) > 0) return { constraints: named, reading: AS_TYPED }

  const around = await aroundThePlace(db, typed) ?? await widerThanNearby(db, typed)
  if (around) return { constraints: around, reading: { ...AS_TYPED, rewritten: lineOf(around) } }

  const forgiven = parse(line, vocabulary, { forgivePlaces: true })
  if (lineOf(forgiven) !== lineOf(typed)) {
    if (await countItineraries(db, forgiven) > 0) {
      return { constraints: forgiven, reading: { ...AS_TYPED, rewritten: lineOf(forgiven) } }
    }
    const aroundForgiven = await aroundThePlace(db, forgiven)
    if (aroundForgiven) {
      return { constraints: aroundForgiven, reading: { ...AS_TYPED, rewritten: lineOf(aroundForgiven) } }
    }
  }

  if (rewrite) {
    const other = await rewriteSafely(rewrite, line, vocabulary)
    if (other !== null && other.trim().toLowerCase() !== line.trim().toLowerCase()) {
      const reread = parse(other, vocabulary)
      if (await countItineraries(db, reread) > 0) {
        return { constraints: reread, reading: { ...AS_TYPED, rewritten: other } }
      }
    }
  }

  const words = unread(typed)
  if (words !== null && typed.length > 1) {
    const without = typed.filter(c => c.kind !== 'name')
    if (await countItineraries(db, without) > 0) {
      return { constraints: without, reading: { ...AS_TYPED, ignored: words } }
    }
    // A `vicino a` is Find's own radius, so it widens here too. A town, or a
    // radius the visitor wrote, does not: words set aside could have been the
    // drive time the town was measured in ("entro 2 ore da Torino").
    const wider = await widerThanNearby(db, without)
    if (wider) return { constraints: wider, reading: { ...AS_TYPED, ignored: words, rewritten: lineOf(wider) } }
  }

  return { constraints: typed, reading: AS_TYPED }
}

/**
 * The line with every town it named read as words of a route's name instead,
 * or null when it named none. The name is matched a word at a time, so the
 * order the words come back in does not matter.
 */
function placesAsName(typed: readonly Constraint[]): readonly Constraint[] | null {
  const places = typed.filter(c => c.kind === 'place')
  if (places.length === 0) return null
  const words = [
    ...places.flatMap(c => (c.kind === 'place' ? [c.name] : [])),
    ...typed.flatMap(c => (c.kind === 'name' ? [c.text] : [])),
  ]
  return [
    ...typed.filter(c => c.kind !== 'place' && c.kind !== 'name'),
    { kind: 'name', text: words.join(' ') },
  ]
}

/**
 * How far Find looks around a town the visitor named when nothing is filed in
 * it: first the sentence's own "nearby", then a drive. The first that finds
 * anything is kept and shown, in its distance menu, as what was asked.
 */
const AROUND_KM = [NEARBY_KM, 80]

/**
 * `falesia Susa`, where nothing is filed under Susa: what a climber means by a
 * town is where they will drive from, not the boundary of its comune. So a
 * place that is somewhere — it has a position, or routes to average one from —
 * and holds nothing that matches is asked as `entro 30 km da Susa`, then 80.
 * Nothing is guessed: the place was read, and the sentence and its note say
 * the question became a distance.
 */
async function aroundThePlace(db: Db, typed: readonly Constraint[]): Promise<readonly Constraint[] | null> {
  if (typed.some(c => c.kind === 'near')) return null
  const places = typed.filter(c => c.kind === 'place')
  if (places.length !== 1) return null
  const place = places[0]!
  if (place.kind !== 'place' || await placeCentre(db, place.id) === null) return null

  for (const withinKm of AROUND_KM) {
    const around = typed.map((c): Constraint =>
      (c === place ? { kind: 'near', placeId: place.id, placeName: place.name, withinKm } : c))
    if (await countItineraries(db, around) > 0) return around
  }
  return null
}

/**
 * `falesia vicino a Torino`, where nothing is within the thirty kilometres
 * "vicino" was taken to mean: the visitor named no figure, so the radius is
 * Find's, and it widens the way a bare town does. A radius the visitor wrote
 * — `entro 30 km` — is theirs and is never widened.
 */
async function widerThanNearby(db: Db, typed: readonly Constraint[]): Promise<readonly Constraint[] | null> {
  const near = typed.find(c => c.kind === 'near')
  if (!near || near.kind !== 'near' || !near.loose) return null
  for (const withinKm of AROUND_KM.filter(km => km > near.withinKm)) {
    const wider = typed.map((c): Constraint => (c === near ? { ...near, withinKm } : c))
    if (await countItineraries(db, wider) > 0) return wider
  }
  return null
}

/**
 * The model asked, and never allowed to break Find: anything it throws is the
 * same as having no model at all. The phrases it may write are read off the
 * registry, as the parser reads them, so the two cannot drift apart.
 */
async function rewriteSafely(rewrite: RewriteLine, line: string, vocabulary: Vocabulary): Promise<string | null> {
  const phrases = vocabulary.activities.flatMap(a =>
    (ACTIVITIES[a.id]?.facts ?? []).flatMap(def => (def.find ?? []).flatMap(f => [...f.it])))
  try {
    return await rewrite({ line, activities: vocabulary.activities.map(a => a.label), phrases })
  } catch (error) {
    console.log(`find: the rewrite failed, answering from the parser alone (${String(error)})`)
    return null
  }
}

/**
 * "CN Crissolo" — the province above a place, then the place. The design's own
 * meta line, and it reads as an address rather than as a breadcrumb.
 */
/**
 * Whether a line finds something in this archive read exactly as typed: every
 * word understood (none kept as a name to look for), nothing reread or set
 * aside. What an example on the open line has to be.
 */
export async function answersAsTyped(db: Db, line: string): Promise<boolean> {
  const { constraints, reading } = await understand(db, line, await vocabularyOf(db), null)
  if (reading.rewritten !== null || reading.ignored !== null) return false
  if (constraints.some(c => c.kind === 'name')) return false
  return (await countItineraries(db, constraints)) > 0
}

export async function whereOf(db: Db, placeId: string, placeName: string): Promise<string> {
  const above = await ancestorsOf(db, placeId)
  const provincia = above.find(p => p.kind === 'provincia')
  return provincia ? `${provincia.name} ${placeName}` : placeName
}

/**
 * Which of a route's breadcrumb places Find can be sent to, and the line that
 * sends it: the activity, then the place — `Falesia Bussoleno`, `Falesia TO`.
 *
 * A crumb is a link only where Find reads its line back as that very place.
 * Two comuni called Samone, or a name some other word of Find's also claims:
 * a line Find would read as something else is a link to a different
 * question, and a breadcrumb must not offer one. Those stay plain text.
 *
 * Parsed against the namesakes of the crumbs only, not the whole archive: the
 * answer is the same and costs a fraction of it, on every route page.
 */
export async function crumbLines(
  db: Db, activity: { readonly id: string; readonly label: string }, places: readonly PlaceRow[],
): Promise<ReadonlyMap<string, string>> {
  const vocabulary: Vocabulary = {
    activities: Object.values(ACTIVITIES)
      .map(schema => ({ id: schema.id, label: schema.label.it }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    places: await placesNamed(db, places.map(p => p.name)),
  }

  const lines = new Map<string, string>()
  for (const place of places) {
    const line = `${activity.label} ${place.name}`
    const read = parse(line, vocabulary)
    const exact = read.length === 2
      && read.some(c => c.kind === 'activity' && c.id === activity.id)
      && read.some(c => c.kind === 'place' && c.id === place.id)
    if (exact) lines.set(place.id, line)
  }
  return lines
}
