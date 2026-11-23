import { activityOf } from '../../domain/activities/index.ts'
import { FactError, resolveFacts, type Part, type StoredFacts } from '../../domain/facts.ts'
import { gradeSteps, type Aspect } from '../../domain/quantity.ts'
import type { NewItineraryInput, NewPartInput } from '../translate.ts'
import { NEVER_NAMED } from './never-named.ts'
import type { OsmRow, OsmSource } from './source.ts'

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** A feature that was not taken, and the one field it was refused on. */
export interface OsmRefusal {
  readonly osm: string
  /** Its name where it has one, so the report can be read without the map open. */
  readonly name: string | null
  readonly field: string
  readonly reason: string
  /** What was there, as OpenStreetMap wrote it. */
  readonly found: string
}

/**
 * A place as Phase 3's writers receive it: what OpenStreetMap and the terrain
 * say about it, and what it still needs written before it can be a page. Never
 * an invented value: a fact nobody measured is in `needs`, not here.
 */
export interface DemoPlace {
  readonly osm: string
  readonly activity: string
  readonly name: string
  /** How the name was read: the `name` tag, or a route's `ref` where it has no name. */
  readonly nameFrom: 'name' | 'ref'
  readonly lat: number
  readonly lon: number
  readonly comune: string
  readonly istat: string | null
  /** Facts the importer could fill, each with where it came from. */
  readonly measured: Readonly<Record<string, { readonly value: string | number; readonly from: string }>>
  /** What the selection of Phase 3 weighs and the writers may lean on; nothing here is a fact on the page. */
  readonly hints: Readonly<Record<string, string>>
  /** Required facts nobody measured: the page cannot exist until they are written, and said to be. */
  readonly needs: readonly string[]
  readonly track: readonly (readonly [number, number])[] | null
  /**
   * For a climbing area: the boulders OpenStreetMap puts in it, each with its
   * name and grade tags. The bouldering schema holds no parts, so they are
   * for the writers, not rows in the database.
   */
  readonly boulders?: readonly BoulderMember[]
}

/** One boulder of an area, as OpenStreetMap tags it. */
export interface BoulderMember {
  readonly osm: string
  readonly name: string | null
  /** Its grade tags (`climbing:grade:font:max`…) and `climbing:routes`, as written. */
  readonly tags: Readonly<Record<string, string>>
}

export type OsmTranslated =
  | { readonly ok: true; readonly place: DemoPlace
      /** The archive's comune, found by its ISTAT code or its name. */
      readonly placeId: string
      /** The row to write now, or null while `needs` is not empty. */
      readonly itinerary: NewItineraryInput | null
      readonly parts: readonly NewPartInput[] }
  | { readonly ok: false; readonly refusals: readonly OsmRefusal[] }
  /** A boulder of an area: neither a place nor refused, but listed under the area it belongs to. */
  | { readonly ok: false; readonly refusals: readonly []; readonly memberOf: string; readonly member: BoulderMember }

/**
 * The comuni this archive holds, handed in so translation stays pure.
 * By ISTAT code first — the sharpest key, since names repeat across Italy —
 * then by name among the two regions, where a name held twice is `null`.
 */
export interface OsmVocabulary {
  readonly comuneByIstat: Readonly<Record<string, string>>
  readonly comuneByName: Readonly<Record<string, string | null>>
  /** The ISTAT province codes (an ISTAT code's first three digits) of the two regions. */
  readonly provinces: ReadonlySet<string>
  /** When the extract read OpenStreetMap: an itinerary's `created`. */
  readonly created: string
}

/**
 * A crag's vie, written in Phase 3 and handed back in. The importer never
 * invents one; without them a crag is taken but not written.
 */
export interface WrittenParts {
  readonly parts: readonly { readonly group?: string | null; readonly fields: StoredFacts }[]
}

// ---------------------------------------------------------------------------
// Reading tags
// ---------------------------------------------------------------------------

/** A slope gentler than this says nothing about which way a wall faces (Phase 0: two of twenty). */
export const MIN_SLOPE_FOR_ASPECT = 15

const ASPECTS: readonly Aspect[] = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
/** OpenStreetMap writes compass points in English. */
const FROM_ENGLISH: Readonly<Record<string, Aspect>> = {
  N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SW: 'SO', W: 'O', NW: 'NO',
}

const GYMS = new Set(['sports_centre', 'fitness_centre', 'sports_hall'])
/** A climbing feature taken as a crag: tagged one, an area of them, or climbing with nothing more said. */
const CRAG_KINDS = new Set(['crag', 'area'])
/** A single route, or the foot or top of one: a multi-pitch where its own tags say so. */
const ROUTE_KINDS = new Set(['route', 'route_bottom', 'route_top'])
const CLIMBING_REFUSED: Readonly<Record<string, string>> = {
  gym: 'a climbing gym is not an outdoor itinerary',
}
const SINGLE_ROUTE = 'a single-pitch route belongs in its crag\'s list, not on a page of its own'
/**
 * Longer than this is more than one pitch: a 60 m rope lowers off 30 m, and
 * leads at most its length. A `climbing:length` beyond it is a multi-pitch.
 */
export const MAX_SINGLE_PITCH = 60
/** The tags that say a place has roped routes, so `climbing:boulder=yes` on it is one discipline among others. */
const SPORT_GRADES: ReadonlySet<string> = new Set(gradeSteps('sport'))
/** What a single rock is mapped as: a boulder is one of these, an area is none. */
const ROCKS = new Set(['rock', 'stone', 'cliff', 'bare_rock'])
const BOULDER_TAGS = /^climbing:(grade:|routes$)/
const ROPED = ['climbing:sport', 'climbing:trad', 'climbing:multipitch', 'climbing:toprope']

/** `6`, ` 12 `: a whole count, or null. */
export function readCount(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const m = /^\s*(\d+)\s*$/.exec(raw)
  return m ? Number(m[1]) : null
}

/** `2345`, `2345 m`, `2345.6`: a height in metres, or null. A comma or a range is not read. */
export function readMetres(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:m)?\s*$/.exec(raw)
  return m ? Math.round(Number(m[1])) : null
}

const isYes = (v: string | undefined) => v !== undefined && /^(yes|true|1)$/i.test(v.trim())

/** The tags Phase 3's selection weighs: prominence, and what a writer may lean on. */
const HINT_TAGS = [
  'wikidata', 'wikipedia', 'name:fr', 'ref', 'network', 'operator', 'cai_scale', 'sac_scale', 'distance',
  'via_ferrata_scale', 'piste:difficulty', 'prominence', 'rock', 'climbing:rock', 'climbing:routes',
  'climbing:grade:french:min', 'climbing:grade:french:max', 'climbing:grade:french:mean',
  'climbing:grade:uiaa:min', 'climbing:grade:uiaa:max', 'climbing:length:min', 'climbing:length:max',
  'climbing:multipitch', 'climbing:orientation', 'description', 'from', 'to',
  'climbing:grade:french', 'climbing:grade:uiaa', 'climbing:pitches', 'climbing:length', 'climbing:bolted',
  'climbing:trad', 'climbing:sport', 'climbing:grade:font', 'climbing:grade:font:min', 'climbing:grade:font:max',
  'climbing:boulder', 'mtb:scale', 'mtb:scale:uphill', 'mtb:scale:imba', 'mtb:type', 'ascent', 'descent', 'roundtrip',
]

// ---------------------------------------------------------------------------
// The translation
// ---------------------------------------------------------------------------

/** What each query is read as. A climbing feature is a crag unless its own tags say otherwise (`climbingKind`). */
const ACTIVITY: Readonly<Record<Exclude<OsmSource, 'climbing'>, string>> = {
  peaks: 'escursionismo', hiking: 'escursionismo',
  via_ferrata: 'via_ferrata', skitour: 'sci_alpinismo', mtb: 'mountain_bike',
}
/** How a route with no name is called after its `ref`. */
const BY_REF: Partial<Record<OsmSource, string>> = { hiking: 'Sentiero', mtb: 'Percorso MTB' }

/**
 * Which climbing activity a climbing feature is, from its tags alone — never
 * from a word in its name — or the refusal that says why it is none.
 *
 *   - a route (or its foot or top) is a multi-pitch where `climbing:multipitch=yes`,
 *     `climbing:pitches` above one or `climbing:length` beyond a single pitch says so,
 *     and otherwise stays in its crag's list;
 *   - `climbing=boulder`, or a rock (`natural=rock|stone|cliff`) that says only
 *     `climbing:boulder=yes`, is one boulder (`single`); `climbing=area`, or a
 *     place drawn as no rock that says only `climbing:boulder=yes`, is an area
 *     of them;
 *   - a crag, an area or climbing with nothing more said is a crag.
 */
function climbingKind(tags: Readonly<Record<string, string>>):
  | { readonly activity: 'falesia' | 'multipitch' | 'bouldering'; readonly single?: boolean }
  | { readonly field: string; readonly reason: string; readonly found: string | undefined } {
  const kind = tags.climbing
  if (kind !== undefined && ROUTE_KINDS.has(kind)) {
    const pitches = readCount(tags['climbing:pitches'])
    const length = readMetres(tags['climbing:length'])
    const saysMulti = isYes(tags['climbing:multipitch'])
    const long = length !== null && length > MAX_SINGLE_PITCH
    if (pitches === 1 && (saysMulti || long)) {
      return { field: 'climbing:pitches', found: tags['climbing:pitches'],
        reason: `says one pitch where ${saysMulti ? 'climbing:multipitch' : 'climbing:length'} says more: which is it?` }
    }
    if (saysMulti || (pitches !== null && pitches > 1) || long) return { activity: 'multipitch' }
    return { field: 'climbing', reason: SINGLE_ROUTE, found: kind }
  }
  // One boulder: tagged one, or a rock that says only that it is bouldered.
  // An area of them: tagged an area, or a place drawn as no rock at all.
  if (kind === 'boulder') return { activity: 'bouldering', single: true }
  if ((kind === undefined || kind === 'area') && isYes(tags['climbing:boulder']) && !ROPED.some(k => isYes(tags[k]))) {
    return { activity: 'bouldering', single: kind === undefined && ROCKS.has(tags.natural ?? '') }
  }
  if (kind !== undefined && !CRAG_KINDS.has(kind)) {
    return { field: 'climbing', reason: CLIMBING_REFUSED[kind] ?? 'not a crag', found: kind }
  }
  return { activity: 'falesia' }
}

/** The aspect a climbing feature faces: its own tag, else the terrain where the slope says anything. */
function aspectFrom(row: OsmRow): { value: Aspect; from: string } | null {
  const tagged = FROM_ENGLISH[row.tags['climbing:orientation']?.trim().toUpperCase() ?? '']
  if (tagged) return { value: tagged, from: 'climbing:orientation' }
  const t = row.terrain
  if (t && t.slope !== undefined && t.facing !== undefined && t.slope >= MIN_SLOPE_FOR_ASPECT) {
    return { value: ASPECTS[Math.round(t.facing / 45) % 8]!, from: `terrain, ${t.slope}° slope` }
  }
  // Flat ground faces nowhere, and `N;E` is two answers, not one.
  return null
}

/**
 * One OpenStreetMap feature, as a place this archive can hold, or refused by
 * name. Pure: the comuni are handed in, and so are a crag's vie when Phase 3
 * has written them.
 *
 * Every refusal names one field. A feature that is not an itinerary at all — a
 * gym, an ice fall, a single route — is refused on what it is and nothing else,
 * so the report counts it once and does not also complain that a gym has no
 * height.
 */
export function translateOsm(row: OsmRow, known: OsmVocabulary, written?: WrittenParts): OsmTranslated {
  const tags = row.tags
  const refusals: OsmRefusal[] = []
  const rawName = tags.name?.trim() || null
  const refuse = (field: string, reason: string, found: unknown): OsmTranslated => {
    // Nothing the report prints may name the site the demo never names.
    const shown = found === undefined ? '(absent)' : String(found)
    refusals.push({
      osm: row.osm, name: rawName && !NEVER_NAMED.test(rawName) ? rawName : null, field, reason,
      found: NEVER_NAMED.test(shown) ? '(withheld)' : shown,
    })
    return { ok: false, refusals }
  }

  // --- what it is: refused on its kind alone
  let activity: string
  if (row.source === 'climbing') {
    if (tags.leisure && GYMS.has(tags.leisure)) return refuse('leisure', 'a climbing gym is not an outdoor itinerary', tags.leisure)
    if (isYes(tags.indoor)) return refuse('indoor', 'a climbing gym is not an outdoor itinerary', tags.indoor)
    if (isYes(tags['climbing:ice']) || tags.climbing === 'ice') {
      return refuse('climbing:ice', 'ice is left out of the demo', tags['climbing:ice'] ?? tags.climbing)
    }
    const k = climbingKind(tags)
    if (!('activity' in k)) return refuse(k.field, k.reason, k.found)
    activity = k.activity
    if (k.single) {
      // A boulder belongs to the area OpenStreetMap puts it in, and is listed
      // there. With none, it is not a place: an area is never invented from
      // boulders lying near each other. A boulder known on its own — with its
      // own Wikidata entry — is the exception, and a place by itself.
      if (row.area !== null) {
        const boulderTags = Object.fromEntries(Object.entries(tags).filter(([t, v]) => BOULDER_TAGS.test(t) && !NEVER_NAMED.test(v)))
        return { ok: false, refusals: [], memberOf: row.area,
          member: { osm: row.osm, name: rawName && !NEVER_NAMED.test(rawName) ? rawName : null, tags: boulderTags } }
      }
      if (!tags.wikidata?.trim()) {
        return refuse('climbing', 'a single boulder with no area: OpenStreetMap lists it in none and draws none around it',
          tags.climbing === 'boulder' ? 'boulder' : `climbing:boulder=yes, natural=${tags.natural}`)
      }
    }
  } else {
    activity = ACTIVITY[row.source]
  }

  // --- the name
  let name = rawName
  let nameFrom: 'name' | 'ref' = 'name'
  const byRef = BY_REF[row.source]
  if (name === null && byRef && tags.ref?.trim()) {
    name = `${byRef} ${tags.ref.trim()}`
    nameFrom = 'ref'
  }
  if (name === null) {
    return refuse('name', byRef
      ? 'a route with no name and no ref cannot be found or told apart'
      : 'a place with no name cannot be found or told apart', tags.name)
  }
  if (NEVER_NAMED.test(name)) return refuse('name', 'names a site the demo never names', name)

  // --- a summit is a walk only where a marked path reaches it
  let summit: number | null = null
  if (row.source === 'peaks') {
    summit = readMetres(tags.ele)
    if (summit === null) return refuse('ele', 'a summit with no height', tags.ele)
    if (!row.onMarkedPath) {
      return refuse('natural', 'a summit no marked path reaches is not an itinerary; '
        + 'alpinismo needs a written route, hand-picked in Phase 3', tags.natural)
    }
  }

  // --- where
  if (row.point === null) {
    return refuse('geometry', byRef
      ? 'a route with no ways of its own (a route of routes) draws no line to start from'
      : 'no position', '(none)')
  }
  if (row.comune === undefined) return refuse('comune', 'never asked: run the extract again', '(not asked)')
  if (row.comune === null) {
    return refuse('comune', 'no comune of OpenStreetMap contains this point (over the border?)',
      `${row.point.lat}, ${row.point.lon}`)
  }
  const placeId = (row.comune.istat ? known.comuneByIstat[row.comune.istat] : undefined)
    ?? known.comuneByName[row.comune.name] ?? undefined
  if (placeId === undefined) {
    const held = row.comune.name in known.comuneByName
    if (row.comune.istat && !known.provinces.has(row.comune.istat.slice(0, 3))) {
      return refuse('comune', 'starts outside Piemonte and Valle d\'Aosta', describeComune(row.comune))
    }
    return refuse('comune', held
      ? 'two comuni of the two regions share this name, and OpenStreetMap gave no ISTAT code to tell them apart'
      : 'no comune of Piemonte or Valle d\'Aosta in the archive has this name: over the border, or the comuni list is not seeded', describeComune(row.comune))
  }

  // --- the facts each activity takes from what was measured
  const schema = activityOf(activity)
  const measured: Record<string, { value: string | number; from: string }> = {}
  const needs: string[] = []
  let aspect: Aspect | null = null
  let altMax: number | null = null

  if (activity === 'falesia') {
    if (!row.terrain) return refuse('quota_base', 'no height was measured at this point: run the extract again', '(none)')
    measured.quota_base = { value: row.terrain.ele, from: 'terrain' }
    const a = aspectFrom(row)
    if (a) { aspect = a.value; measured.esposizione = a }
    // Unknown, not guessed: Phase 3 writes it and says so.
    else needs.push('esposizione')
    if (!written || written.parts.length === 0) needs.push('vie')
  } else if (activity === 'multipitch') {
    // Every fact of a multi-pitch is optional: what the tags hold is filled,
    // what they do not is left out, and a value off the scale stays a hint.
    if (row.terrain) measured.quota_base = { value: row.terrain.ele, from: 'terrain' }
    const a = aspectFrom(row)
    if (a) { aspect = a.value; measured.esposizione = a }
    // A route's grade, as OpenStreetMap and every guidebook give it, is its
    // hardest move. What cannot be pulled through on the bolts no tag records.
    for (const k of ['climbing:grade:french:max', 'climbing:grade:french']) {
      const g = tags[k]?.trim()
      if (g && SPORT_GRADES.has(g)) { measured.grado_max = { value: g, from: k }; break }
    }
    const length = readMetres(tags['climbing:length'])
    if (length !== null && length > 0) measured.sviluppo = { value: length, from: 'climbing:length' }
    const pitches = readCount(tags['climbing:pitches'])
    if (pitches !== null && pitches > 1) measured.tiri = { value: pitches, from: 'climbing:pitches' }
    // Bolts and gear both: to be completed. Bolts alone: bolted. Gear alone: trad.
    const bolted = isYes(tags['climbing:bolted']), trad = isYes(tags['climbing:trad'])
    if (bolted && trad) measured.protezione = { value: 'da_integrare', from: 'climbing:bolted, climbing:trad' }
    else if (bolted) measured.protezione = { value: 'spittata', from: 'climbing:bolted' }
    else if (trad) measured.protezione = { value: 'trad', from: 'climbing:trad' }
  } else if (row.source === 'peaks') {
    measured.vetta = { value: summit!, from: 'ele' }
    altMax = summit
  } else if (row.source === 'hiking' || row.source === 'skitour') {
    if (row.source === 'hiking' && tags.cai_scale?.trim()) measured.difficolta = { value: tags.cai_scale.trim(), from: 'cai_scale' }
  }

  const hints: Record<string, string> = {}
  for (const k of HINT_TAGS) {
    const v = tags[k]
    if (v !== undefined && !NEVER_NAMED.test(v)) hints[k] = v
  }
  // A line's first point is not always where it starts: OpenStreetMap does
  // not promise which way a way runs, and a ski tour drawn from the summit
  // down would get the summit's height as its `partenza`. So the height there
  // is a hint, never the fact.
  if (row.source !== 'climbing' && row.source !== 'peaks' && row.terrain) {
    hints.quota_primo_punto = String(row.terrain.ele)
  }

  const place: DemoPlace = {
    osm: row.osm, activity, name, nameFrom, lat: row.point.lat, lon: row.point.lon,
    comune: row.comune.name, istat: row.comune.istat,
    measured, hints, needs, track: row.track,
  }
  if (needs.length > 0) return { ok: true, place, placeId, itinerary: null, parts: [] }

  // --- complete: the row to write, held to the registry exactly as the seed is
  const facts: StoredFacts = Object.fromEntries(Object.entries(measured).map(([k, m]) => [k, m.value]))
  const parts: NewPartInput[] = (written?.parts ?? []).map((p, i) => ({
    group: p.group ?? null, position: i + 1, fields: p.fields,
  }))
  try {
    resolveFacts(schema, facts, parts.map((p, i): Part => ({ id: String(i), ...p })))
  } catch (err) {
    if (err instanceof FactError) return refuse('facts', err.message, JSON.stringify(facts))
    throw err
  }
  return {
    ok: true, place, placeId, parts,
    itinerary: {
      activity, placeId, name, lat: row.point.lat, lon: row.point.lon,
      parkingLat: null, parkingLon: null, aspect, altMax, facts, sections: {}, created: known.created,
    },
  }
}

function describeComune(c: { name: string; istat: string | null }): string {
  return c.istat ? `${c.name} (ISTAT ${c.istat})` : c.name
}
