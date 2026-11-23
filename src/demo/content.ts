/**
 * The public demo's written content, laid over the place OpenStreetMap measured.
 *
 * One content file per place, `src/seed/sets/demo/content/<osm>.json`: the
 * OpenStreetMap id it writes for, what was made up (`invented`), the itinerary
 * in the seed's own shape, and one recorded reading per report. A content file
 * adds what OpenStreetMap cannot hold — descriptions, a crag's vie, reports —
 * and never decides what or where a place is: its activity, name, comune,
 * position and every measured fact come from the importer, and a content file
 * that says otherwise is refused by name, field and both values.
 *
 * Pure: the measured place is handed in, nothing is read or written here.
 */
import type { DemoPlace } from '../import/osm/translate.ts'
import { NEVER_NAMED } from '../import/osm/never-named.ts'
import type { RecordedReading } from './replayed-model.ts'

export interface ContentReport {
  readonly observedAt: string
  readonly words: string
  readonly photos?: readonly { file: string; caption?: string }[]
}

/** The itinerary as a content file writes it: the seed's shape, every measured field optional. */
export interface ContentItinerary {
  readonly key: string
  readonly activity?: string
  readonly place?: string
  readonly name?: string
  readonly lat?: number
  readonly lon?: number
  readonly parkingLat?: number
  readonly parkingLon?: number
  readonly aspect?: string
  readonly altMax?: number
  readonly facts?: Readonly<Record<string, unknown>>
  readonly sections?: Readonly<Record<string, string>>
  readonly parts?: readonly { group?: string; fields: Record<string, unknown> }[]
  readonly reports?: readonly ContentReport[]
}

export interface ContentFile {
  readonly osm: string
  /** What was made up for this place, said so in the repo: `vie`, `reports`, a fact's id… */
  readonly invented: readonly string[]
  readonly itinerary: ContentItinerary
  /** One per report, in the same order: the themes and changes its writer planted. */
  readonly readings?: readonly (RecordedReading | null)[]
}

/** The itinerary handed to the seed: a content file's, with everything measured put back. */
export interface DemoItinerary {
  key: string; activity: string; place: string; name: string
  lat: number; lon: number; parkingLat?: number; parkingLon?: number
  aspect?: string; altMax?: number
  facts: Record<string, unknown>
  sections: Record<string, string>
  parts: { group?: string; fields: Record<string, unknown> }[]
  reports: ContentReport[]
}

export type Composed =
  | { readonly kind: 'built'; readonly itinerary: DemoItinerary }
  /** A required fact still unwritten: the place is left out, never filled in. */
  | { readonly kind: 'left-out'; readonly needs: readonly string[] }
  /** The content contradicts what was measured, or breaks the contract: every problem, by field. */
  | { readonly kind: 'refused'; readonly problems: readonly string[] }

/** How far a written position may sit from the measured one: rounding, not another place (~50 m). */
const SAME_POINT = 0.0005

/**
 * A content file read as JSON, checked only for its shape: the problems, by
 * field, or the file. What it says is weighed against the place in `compose`.
 */
export function readContent(text: string): { ok: true; content: ContentFile } | { ok: false; problems: string[] } {
  const problems: string[] = []
  if (NEVER_NAMED.test(text)) problems.push('(anywhere): names the site the demo never names')
  let doc: any
  try { doc = JSON.parse(text) } catch (err) {
    return { ok: false, problems: [...problems, `(file): not JSON: ${(err as Error).message}`] }
  }
  if (typeof doc?.osm !== 'string' || !/^[nwr]\d+$/.test(doc.osm)) problems.push(`osm: expected an OpenStreetMap id like w123, found ${JSON.stringify(doc?.osm)}`)
  if (!Array.isArray(doc?.invented) || !doc.invented.every((x: unknown) => typeof x === 'string')) {
    problems.push('invented: expected a list of what was made up')
  }
  const it = doc?.itinerary
  if (typeof it !== 'object' || it === null) problems.push('itinerary: missing')
  else {
    if (typeof it.key !== 'string' || !/^[a-z0-9-]+$/.test(it.key)) problems.push(`itinerary.key: expected a slug, found ${JSON.stringify(it.key)}`)
    const reports = it.reports ?? []
    if (!Array.isArray(reports)) problems.push('itinerary.reports: expected a list')
    else if (doc.readings !== undefined) {
      if (!Array.isArray(doc.readings)) problems.push('readings: expected a list')
      // Readings are matched to reports by their words, but a list out of step
      // with the reports was written against other reports.
      else if (doc.readings.length !== reports.length) {
        problems.push(`readings: ${doc.readings.length} readings for ${reports.length} reports`)
      }
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, content: doc as ContentFile }
}

/**
 * The content laid over its measured place.
 *
 *   - the activity, the name, the comune and the position are the place's; a
 *     content file may repeat them, and must then agree;
 *   - every measured fact is kept, and a written one with the same id must be
 *     the same value;
 *   - each fact the place still `needs` must be written, and said to be
 *     invented; one still missing leaves the place out of the build.
 */
export function compose(place: DemoPlace, placeKey: string, content: ContentFile): Composed {
  const c = content.itinerary
  const problems: string[] = []
  const differ = (field: string, written: unknown, measured: unknown, from = 'OpenStreetMap') =>
    problems.push(`itinerary.${field}: written ${JSON.stringify(written)}, but ${from} says ${JSON.stringify(measured)}`)

  if (c.activity !== undefined && c.activity !== place.activity) differ('activity', c.activity, place.activity)
  if (c.name !== undefined && c.name !== place.name) differ('name', c.name, place.name)
  if (c.place !== undefined && c.place !== placeKey) differ('place', c.place, placeKey)
  if (c.lat !== undefined && Math.abs(c.lat - place.lat) > SAME_POINT) differ('lat', c.lat, place.lat)
  if (c.lon !== undefined && Math.abs(c.lon - place.lon) > SAME_POINT) differ('lon', c.lon, place.lon)

  const written = c.facts ?? {}
  const facts: Record<string, unknown> = { ...written }
  for (const [id, m] of Object.entries(place.measured)) {
    if (written[id] !== undefined && written[id] !== m.value) differ(`facts.${id}`, written[id], m.value, m.from)
    facts[id] = m.value
  }

  const measuredAspect = place.measured.esposizione?.value
  if (measuredAspect !== undefined && c.aspect !== undefined && c.aspect !== measuredAspect) {
    differ('aspect', c.aspect, measuredAspect, place.measured.esposizione!.from)
  }
  const aspect = measuredAspect !== undefined ? String(measuredAspect)
    : c.aspect ?? (typeof facts.esposizione === 'string' ? facts.esposizione : undefined)
  const summit = place.measured.vetta?.value
  if (summit !== undefined && c.altMax !== undefined && c.altMax !== summit) differ('altMax', c.altMax, summit, 'ele')
  const altMax = typeof summit === 'number' ? summit : c.altMax

  const parts = [...(c.parts ?? [])]
  const unmet: string[] = []
  for (const need of place.needs) {
    const supplied = need === 'vie' ? parts.length > 0 : written[need] !== undefined
    if (!supplied) unmet.push(need)
    else if (!content.invented.includes(need)) {
      problems.push(`invented: ${need} was not measured and is written here, so it must be listed as invented`)
    }
  }

  if (problems.length > 0) return { kind: 'refused', problems }
  if (unmet.length > 0) return { kind: 'left-out', needs: unmet }
  return {
    kind: 'built',
    itinerary: {
      key: c.key, activity: place.activity, place: placeKey, name: place.name, lat: place.lat, lon: place.lon,
      ...(c.parkingLat !== undefined && c.parkingLon !== undefined ? { parkingLat: c.parkingLat, parkingLon: c.parkingLon } : {}),
      ...(aspect !== undefined ? { aspect } : {}),
      ...(altMax !== undefined ? { altMax } : {}),
      facts, sections: { ...(c.sections ?? {}) }, parts, reports: [...(c.reports ?? [])],
    },
  }
}
