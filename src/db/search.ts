import type { Db, SqlParams } from './open.ts'
import type { Constraint, GradeSystem, Vocabulary } from '../domain/find/constraints.ts'
import { ACTIVITIES } from '../domain/activities/index.ts'
import type { ActivitySchema } from '../domain/registry.ts'
import { boundingBox, type Point } from '../domain/geo.ts'
import type { StoredFacts } from '../domain/facts.ts'

/**
 * What the ranked list is built from. One row per itinerary, carrying what a
 * result row shows and what `rank` weighs — and nothing else. `sections` is
 * left behind on purpose: prose is not a list, and a hundred candidates would
 * carry a hundred route descriptions nobody reads.
 *
 * The condition is not here either. It is a query per route and it belongs to
 * the service, which grades only the candidates it is about to show.
 */
export interface CandidateRow {
  readonly id: string
  readonly activity: string
  readonly name: string
  readonly placeId: string
  /** The place's own name, for the row's meta line — "CN Crissolo", not an id. */
  readonly placeName: string
  readonly lat: number | null
  readonly lon: number | null
  /** Where the car is left; for a route that starts there, where its weather is asked for. */
  readonly parkingLat: number | null
  readonly parkingLon: number | null
  readonly altMax: number | null
  /** Ordinals on the activity's own scale. Null where the route declares none. */
  readonly gradeMin: number | null
  readonly gradeMax: number | null
  /**
   * Which scale those ordinals are on. It travels with the row for the same
   * reason it travels with a grade constraint: without it they are integers
   * about nothing, and `rank` would compare an alpine 6 against a sport 6.
   */
  readonly gradeScale: GradeSystem | null
  /** Enough to print a grade and a height gain without a query per row. */
  readonly facts: StoredFacts
}

/** The shape `boundingBox` in `src/domain/geo.ts` returns. */
export interface Box {
  readonly minLat: number
  readonly maxLat: number
  readonly minLon: number
  readonly maxLon: number
}

interface Fragment {
  readonly sql: string
  readonly params: SqlParams
}

// ---------------------------------------------------------------------------
// Scales, read off the registry
// ---------------------------------------------------------------------------

const GRADE_KIND = 'grade:'

/**
 * The grade scales an activity declares, whether in its facts (alpinismo's
 * `difficolta`) or in its parts (falesia's pitches). The same question
 * `gradeBoundsOf` asks of a quantity, asked of a whole schema — nothing here is
 * a list of activities written into this file.
 */
function systemsOf(schema: ActivitySchema): GradeSystem[] {
  const found = new Set<GradeSystem>()

  for (const def of [...schema.facts, ...(schema.parts?.fields ?? [])]) {
    if (!def.quantity.kind.startsWith(GRADE_KIND)) continue
    const system = def.quantity.kind.slice(GRADE_KIND.length)
    // A third scale widens `GradeSystem` and this line together; until it does,
    // one nobody has declared is skipped rather than typed as one of these two.
    if (system === 'alpine' || system === 'sport') found.add(system)
  }
  return [...found]
}

/**
 * Every activity that uses this scale.
 *
 * This is what makes the grade fragment safe by construction rather than by
 * trusting that a caller checked: an ordinal is an index into one scale's steps,
 * `AD` is 6 on the alpine scale and `6a` is 13 on the sport one, and a comparison
 * across the two is arithmetic on two different numbers that happen to both be
 * integers. Restricting the rows to the activities that actually use the scale
 * is the only way the comparison means anything.
 */
function activitiesOnScale(system: GradeSystem): string[] {
  return Object.entries(ACTIVITIES)
    .filter(([, schema]) => systemsOf(schema).includes(system))
    .map(([id]) => id)
    .sort()
}

/**
 * The scale a route's stored ordinals are on, read from its activity — the
 * inverse of `activitiesOnScale`, and what lets a candidate row hand `rank` an
 * ordinal that means something.
 *
 * Null unless the activity declares exactly one scale. Two would make the row's
 * bounds a mixture of two numberings, and naming either of them would be a
 * guess; a row that says it is on no scale is one `rank` leaves out of its
 * grade arithmetic, which is the right answer to a question nobody can answer.
 */
export function scaleOf(activity: string): GradeSystem | null {
  const schema = ACTIVITIES[activity]
  if (!schema) return null
  const systems = systemsOf(schema)
  return systems.length === 1 ? systems[0]! : null
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/**
 * Everything at or under a place: the administrative chain downward, plus the
 * members of a named area, plus the same again for each of those.
 *
 * A route in Crissolo is in CN is in Piemonte, so typing a region has to find
 * the comuni inside it; and `place_area` holds the memberships the hierarchy
 * cannot express — Gran Paradiso holds Noasca in Piemonte and Cogne in Valle
 * d'Aosta, which are a region apart. Both edges are followed, and followed
 * again from what they reach, because an area may hold a comune that holds
 * frazioni and the visitor who typed the area meant those too.
 *
 * No depth cap, and this is the one recursion in the project that does not want
 * one. `union` — not `union all` — means a place already reached is never
 * queued again, so the walk terminates on a finite table even if the data ever
 * grows a cycle. `ancestorsOf` needs its cap precisely because it uses
 * `union all` to keep the depth it orders by.
 */
const UNDER = `
  with recursive under(id) as (
    select ?
    union
    select p.id from place p join under u on p.parent_id = u.id
    union
    select pa.place_id from place_area pa join under u on pa.area_id = u.id
  )
  select id from under`

function placeFragment(placeId: string): Fragment {
  return { sql: `i.place_id in (${UNDER})`, params: [placeId] }
}

/** `\`, `%` and `_` are LIKE's own, and a visitor typing one means the character. */
function likeContains(word: string): string {
  return `%${word.replace(/[\\%_]/g, m => `\\${m}`)}%`
}

/**
 * Free text, matched against route names a word at a time.
 *
 * Not one substring: the parser hands on what it could not read with the parts
 * it *did* read taken out from between the words, so `Balma Scura a Bussoleno`
 * arrives as `Balma Scura a` once the place is gone, and a single `like` on the
 * join would ask the archive for a route whose name contains a stray
 * preposition. Each word narrows, and they narrow together.
 *
 * `like` folds case for ASCII and nothing else. Accents do not fold here, where
 * the parser folds them for the vocabulary — matching in memory can normalise,
 * and matching in SQL would need a second, folded column. That is a promotion
 * this project does not make.
 */
function nameFragment(text: string): Fragment | null {
  const words = text.split(/\s+/u).filter(w => w !== '')
  if (words.length === 0) return null

  return {
    sql: words.map(() => `i.name like ? escape '\\'`).join(' and '),
    params: words.map(likeContains),
  }
}

/**
 * A grade range, narrowed to the rows whose ordinals are on the same scale.
 *
 * Two halves, and the first is not optional. The scale half restricts the rows
 * to the activities that use the scale; only then does the ordinal half mean
 * anything. A grade constraint arrives with an inferred activity where the
 * parser could name one, with a typed activity that may contradict it
 * (`alpinismo dal 6a al 7b` yields both, and the honest answer is an empty
 * list), and with no activity at all when the line's grades disagree about the
 * scale. In all three the scale travels with the constraint and this fragment
 * reads it, rather than assuming an activity constraint arrived to do the job.
 *
 * The ordinal half is an overlap, not a containment: a crag running 5a to 7b is
 * what a visitor asking for 6a wants, and holding pitches harder than the
 * question does not disqualify it. Where the route's range sits inside the
 * asked one, and how near the edge it is, is `rank`'s arithmetic and not a
 * question for SQL.
 *
 * A route declaring no grade is not returned. A grade constraint is a question
 * about the scale, and a route that records nothing on it answers nothing;
 * carrying it through would put an unknown quantity inside a bound the visitor
 * set.
 */
function gradeFragment(scale: GradeSystem, min: number, max: number): Fragment {
  const activities = activitiesOnScale(scale)
  // A scale no registry file declares selects nothing, rather than producing
  // `in ()`, which is not SQL. Unreachable from the parser, which reads its
  // scales off the registry too; reachable from a hand-built constraint set.
  if (activities.length === 0) return { sql: '1 = 0', params: [] }

  return {
    sql: `i.activity in (${activities.map(() => '?').join(', ')})
          and i.grade_min is not null and i.grade_max is not null
          and i.grade_min <= ? and i.grade_max >= ?`,
    params: [...activities, max, min],
  }
}

/**
 * A fact a Find phrase named, tested against the stored JSON. The fact's id
 * and value are parameters like everything else; only this file writes SQL.
 *
 * A crag where the fact is absent does not match: json_extract of a missing
 * key is null and json_each of a missing path is empty, so an unrecorded fact
 * answers nothing, which is the honest answer to a question nobody recorded.
 * JSON true and false come back from json_extract as 1 and 0.
 *
 * A fact the registry derives by counting parts — a crag's `vie` — is never
 * stored, so it is counted here, from the parts themselves. A phrase several
 * activities share is asked of each in its own terms, and a route of any of
 * them may answer.
 */
function factFragment(c: Extract<Constraint, { kind: 'fact' }>): Fragment {
  const each = c.activities.map(activity => factTestOf(activity, c))
  if (each.length === 0) return { sql: '1 = 0', params: [] }
  return {
    sql: each.map(f => `(${f.sql})`).join(' or '),
    params: each.flatMap(f => f.params),
  }
}

function factTestOf(activity: string, c: Extract<Constraint, { kind: 'fact' }>): Fragment {
  const path = `$.${c.id}`
  if (c.match === 'includes') {
    return {
      sql: `i.activity = ? and exists (select 1 from json_each(i.facts, ?) where value = ?)`,
      params: [activity, path, String(c.value)],
    }
  }

  const def = ACTIVITIES[activity]?.facts.find(f => f.id === c.id)
  const counted = def?.derived?.from === 'parts' && def.derived.op === 'count'
  const stored = counted ? `(select count(*) from part pt where pt.itinerary_id = i.id)` : `json_extract(i.facts, ?)`
  const storedParams = counted ? [] : [path]
  const op = c.match === 'atMost' ? '<=' : c.match === 'atLeast' ? '>=' : '='
  const value = typeof c.value === 'boolean' ? (c.value ? 1 : 0) : c.value
  return { sql: `i.activity = ? and ${stored} ${op} ?`, params: [activity, ...storedParams, value] }
}

/** The bounding-box prefilter, exactly as the neighbour query uses it. */
function boxFragment(box: Box): Fragment {
  return {
    sql: `i.lat is not null and i.lon is not null
          and i.lat between ? and ? and i.lon between ? and ?`,
    params: [box.minLat, box.maxLat, box.minLon, box.maxLon],
  }
}

function fragmentOf(c: Constraint): Fragment | null {
  switch (c.kind) {
    case 'activity': return { sql: 'i.activity = ?', params: [c.id] }
    case 'place':    return placeFragment(c.id)
    case 'name':     return nameFragment(c.text)
    case 'grade':    return gradeFragment(c.scale, c.min, c.max)
    case 'fact':     return factFragment(c)
    // `near` narrows through its box, which the caller resolves: a place in this
    // archive has no coordinates of its own, so where it is takes a query.
    case 'near':     return null
    // A route's condition is graded from its evidence by the engine, never
    // stored; Find holds the graded shortlist to it, after this query.
    // Weather is cached per coordinate and refreshed on read; Find holds the
    // shortlist to it, after this query, as it does a condition.
    case 'dry':      return null
  }
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

const COLUMNS = `i.id, i.activity, i.name, i.place_id, p.name as place_name,
                 i.lat, i.lon, i.parking_lat, i.parking_lon, i.alt_max, i.grade_min, i.grade_max, i.facts`

interface RawCandidate {
  id: string; activity: string; name: string; place_id: string; place_name: string
  lat: number | null; lon: number | null; alt_max: number | null
  parking_lat: number | null; parking_lon: number | null
  grade_min: number | null; grade_max: number | null
  facts: string
}

/**
 * The query a constraint set makes, composed rather than concatenated: every
 * fragment is written in this file, every value is a parameter, and nothing a
 * visitor typed is ever spliced into SQL text. That is the cheap version of the
 * typed query builder the archive spec left open and zero dependencies rules out.
 *
 * Exported because the narrowing has to be *in* the query and a test has to be
 * able to prove it — `explain query plan` over what this returns is the proof
 * that a filter further up is not quietly doing the work.
 */
export interface Shortlist {
  /** Where the question was asked from, when it named a place. */
  readonly centre?: { readonly lat: number; readonly lon: number } | null
  /** How many rows to return. Absent means all of them. */
  readonly limit?: number
}

/**
 * How the rows come back, and why the order matters even though the domain
 * reranks them.
 *
 * Grading a route costs a query, so only the head of the answer can be graded
 * and ranked properly. That makes this ordering the shortlist: whatever it puts
 * first is all the ranking will ever see. Ordering by name — which is what this
 * did at first — meant that at any scale above the shortlist the whole ranking
 * was a sort of the alphabetically-first routes, which is a ranking in form and
 * not in substance.
 *
 * So the shortlist is ordered by the cheapest honest proxy for the question that
 * was actually asked. Where a place was named, that is distance — as squared
 * degrees, which is monotonic in real distance over an extent this size and
 * needs no trigonometry in SQL; the true radius is still decided in the domain.
 * Otherwise it is recency, because a route somebody reported on this week is
 * more likely to be worth offering.
 */
function orderBy(list: Shortlist): Fragment {
  if (list.centre) {
    return {
      sql: `case when i.lat is null then 1 else 0 end,
            (i.lat - ?) * (i.lat - ?) + (i.lon - ?) * (i.lon - ?), i.name, i.id`,
      params: [list.centre.lat, list.centre.lat, list.centre.lon, list.centre.lon],
    }
  }
  return {
    // The newest standing report, filed or imported. Two-argument max() is
    // null if either side is, so each side falls back to '' and '' back to null.
    sql: `nullif(max(coalesce((select max(g.observed_at) from gita g
                where g.itinerary_id = i.id
                  and not exists (select 1 from retraction r where r.gita_id = g.id)), ''),
               coalesce((select max(ir.observed_at) from imported_report ir
                where ir.itinerary_id = i.id), '')), '') desc nulls last,
          i.name, i.id`,
    params: [],
  }
}

export function searchQuery(
  constraints: readonly Constraint[], boxes: readonly Box[], list: Shortlist = {},
): { sql: string; params: SqlParams } {
  const fragments: Fragment[] = []

  for (const c of constraints) {
    const fragment = fragmentOf(c)
    if (fragment) fragments.push(fragment)
  }
  for (const box of boxes) fragments.push(boxFragment(box))

  // An empty constraint set is a legitimate question, and its answer is the
  // archive. `1 = 1` keeps the shape of the statement rather than making the
  // `where` itself conditional.
  const where = fragments.length === 0
    ? '1 = 1'
    : fragments.map(f => `(${f.sql})`).join('\n    and ')

  const order = orderBy(list)

  return {
    sql: `
    select ${COLUMNS}
    from itinerary i
    join place p on p.id = i.place_id
    where ${where}
    order by ${order.sql}${list.limit === undefined ? '' : `
    limit ${String(Math.max(0, Math.floor(list.limit)))}`}`,
    params: [...fragments.flatMap(f => [...f.params]), ...order.params],
  }
}

/**
 * How many routes the question admits, which is not how many are shown. The
 * count above the list is the size of the answer; loading the answer to measure
 * it is what this exists to avoid.
 */
export function countQuery(
  constraints: readonly Constraint[], boxes: readonly Box[],
): { sql: string; params: SqlParams } {
  const fragments: Fragment[] = []
  for (const c of constraints) {
    const fragment = fragmentOf(c)
    if (fragment) fragments.push(fragment)
  }
  for (const box of boxes) fragments.push(boxFragment(box))

  const where = fragments.length === 0
    ? '1 = 1'
    : fragments.map(f => `(${f.sql})`).join('\n    and ')

  return {
    sql: `select count(*) as n from itinerary i
          join place p on p.id = i.place_id
          where ${where}`,
    params: fragments.flatMap(f => [...f.params]),
  }
}

/**
 * Where a place is, as far as this archive knows: the mean position of the
 * itineraries under it.
 *
 * No place carries coordinates — `place` holds a name, a kind and a parent —
 * and promoting them would be a second migration in a project whose spec says
 * grade is the only promotion it makes. So a place is where its routes are,
 * which is both derivable today and true in the only sense the archive can
 * mean it: Crissolo is where the things in Crissolo are.
 *
 * Null where nothing under the place has coordinates. A caller must not read
 * that as "nothing is near it" — there is simply nothing to measure from.
 */
export async function placeCentre(db: Db, placeId: string): Promise<Point | null> {
  // Its own position first, where it has one. A place you travel from -- a city,
  // a road head -- holds no routes, so the average below would be null for the
  // one kind of place a `near` constraint is most often about.
  const own = await db.get<{ lat: number | null; lon: number | null }>(
    `select lat, lon from place where id = ?`, [placeId])
  if (own?.lat !== null && own?.lat !== undefined && own.lon !== null) {
    return { lat: own.lat, lon: own.lon }
  }

  const row = await db.get<{ lat: number | null; lon: number | null }>(`
    select avg(i.lat) as lat, avg(i.lon) as lon
    from itinerary i
    where i.lat is not null and i.lon is not null
      and i.place_id in (${UNDER})`, [placeId])

  return row?.lat === null || row?.lat === undefined || row.lon === null
    ? null
    : { lat: row.lat, lon: row.lon }
}

/**
 * The candidates a constraint set admits. Hard constraints narrow here and
 * nothing else does: how close is close enough, and how near the edge of a
 * grade range a route sits, are decisions, and decisions are arithmetic over
 * values with no database attached.
 *
 * A `near` constraint contributes its bounding box — the same prefilter the
 * neighbour query uses, and for the same reason: the box is indexed and the
 * true radius is not. The radius itself is decided in `rank`, so a route in the
 * corner of the box survives to be weighed rather than being cut here.
 *
 * `bbox` is an extra box a caller already holds — the map's fixed extent is the
 * one this project has — and it narrows alongside the constraints' own.
 */
export async function searchItineraries(
  db: Db, constraints: readonly Constraint[], bbox?: Box, list: Shortlist = {},
): Promise<CandidateRow[]> {
  const boxes: Box[] = []

  for (const c of constraints) {
    if (c.kind !== 'near') continue
    const centre = await placeCentre(db, c.placeId)
    if (centre) boxes.push(boundingBox(centre, c.withinKm * 1000))
  }
  if (bbox) boxes.push(bbox)

  const { sql, params } = searchQuery(constraints, boxes, list)
  const rows = await db.all<RawCandidate>(sql, params)

  return rows.map(r => ({
    id: r.id, activity: r.activity, name: r.name,
    placeId: r.place_id, placeName: r.place_name,
    lat: r.lat, lon: r.lon, parkingLat: r.parking_lat, parkingLon: r.parking_lon, altMax: r.alt_max,
    gradeMin: r.grade_min, gradeMax: r.grade_max, gradeScale: scaleOf(r.activity),
    facts: JSON.parse(r.facts) as StoredFacts,
  }))
}

/**
 * What the parser is allowed to recognise: every place the archive holds, and
 * every activity the registry declares.
 *
 * The two halves come from different places on purpose. A place exists because
 * a row says so, so an archive with no crags in Liguria offers no Liguria. An
 * activity exists because a registry file declares it, whether or not anything
 * has been filed under it yet — typing it is a legitimate question whose honest
 * answer is an empty list, and the nineteenth activity is a word a visitor can
 * type on the day it is added and before it holds anything.
 */
export async function vocabularyOf(db: Db): Promise<Vocabulary> {
  const places = await db.all<{ id: string; name: string }>(
    'select id, name from place order by name, id')

  return {
    activities: Object.values(ACTIVITIES)
      .map(schema => ({ id: schema.id, label: schema.label.it }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    places,
  }
}

/**
 * How many routes each activity holds, most first — the home screen's list.
 * Counted in SQL because counting is finding, and an archive of 35,000 routes
 * is not something to load in order to measure.
 */
export async function activityCounts(db: Db): Promise<{ id: string; n: number }[]> {
  return db.all<{ id: string; n: number }>(
    `select activity as id, count(*) as n from itinerary group by activity order by n desc`)
}

/**
 * How many routes the question admits. Counted in SQL, because the answer to
 * "35.000 itinerari" must not cost 35,000 rows.
 */
export async function countItineraries(
  db: Db, constraints: readonly Constraint[], bbox?: Box,
): Promise<number> {
  const boxes: Box[] = []
  for (const c of constraints) {
    if (c.kind !== 'near') continue
    const centre = await placeCentre(db, c.placeId)
    if (centre) boxes.push(boundingBox(centre, c.withinKm * 1000))
  }
  if (bbox) boxes.push(bbox)

  const { sql, params } = countQuery(constraints, boxes)
  return (await db.get<{ n: number }>(sql, params))?.n ?? 0
}
