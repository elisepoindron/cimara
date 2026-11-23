import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lineOf, osmId, pointOf, type LatLon, type OsmElement } from './element.ts'
import type { Terrain } from './terrain.ts'
import { areaOf, type ClimbingArea } from './areas.ts'

/** Which Overpass query a feature came from: the extract's file name. */
export type OsmSource = 'climbing' | 'peaks' | 'hiking' | 'via_ferrata' | 'skitour' | 'mtb'
export const SOURCES: readonly OsmSource[] = ['climbing', 'via_ferrata', 'skitour', 'hiking', 'mtb', 'peaks']

export interface ComuneAnswer { readonly name: string; readonly istat: string | null }

/**
 * One OpenStreetMap feature with everything the extract measured about it,
 * exactly as measured. Nothing here is judged: a gym is still a row, a summit
 * with no height is still a row. Refusing them is the translator's job, where
 * the reason can be named.
 */
export interface OsmRow {
  readonly osm: string
  readonly source: OsmSource
  readonly tags: Readonly<Record<string, string>>
  readonly point: LatLon | null
  /** The line it draws, as [lat, lon], where it draws one. */
  readonly track: readonly (readonly [number, number])[] | null
  /** The comune OpenStreetMap says contains the point; null where none does, undefined where never asked. */
  readonly comune: ComuneAnswer | null | undefined
  readonly terrain: Terrain | null
  /** For a summit: whether a marked hiking route reaches it. */
  readonly onMarkedPath: boolean
  /** For a climbing feature: the climbing area OpenStreetMap puts it in, by its id, or null. */
  readonly area: string | null
}

export interface OsmExtract {
  readonly rows: readonly OsmRow[]
  /** When OpenStreetMap was read, per source: the data's own date. */
  readonly osmBase: Readonly<Record<string, string>>
}

export class OsmSourceError extends Error {}

async function json(dir: string, file: string): Promise<Record<string, unknown>> {
  const path = join(dir, file)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    throw new OsmSourceError(`cannot read ${path}: ${(err as Error).message}`, { cause: err })
  }
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5

/** Every feature of an extract written by scripts/osm/extract.ts, with its comune and terrain beside it. */
export async function readExtract(dir: string): Promise<OsmExtract> {
  const comuni = ((await json(dir, 'comuni.json')).comuni ?? {}) as Record<string, ComuneAnswer | null>
  const terrain = ((await json(dir, 'terrain.json')).terrain ?? {}) as Record<string, Terrain>
  const onPaths = new Set(((await json(dir, 'peaks-on-paths.json')).elements as OsmElement[] ?? []).map(osmId))
  const areas = ((await json(dir, 'climbing-areas.json')).areas ?? []) as ClimbingArea[]

  const rows: OsmRow[] = []
  const osmBase: Record<string, string> = {}
  for (const source of SOURCES) {
    const file = await json(dir, `${source}.json`)
    if (!Array.isArray(file.elements)) throw new OsmSourceError(`${source}.json holds no "elements" array`)
    osmBase[source] = String(file.timestamp ?? '')
    for (const e of file.elements as OsmElement[]) rows.push(rowOf(source, e, comuni, terrain, onPaths))
  }
  // Every climbing feature is asked which area it is in; the translator
  // decides which of them are boulders that belong to one.
  const within = areaOf(rows.filter(r => r.source === 'climbing'), areas)
  return { rows: rows.map(r => within.has(r.osm) ? { ...r, area: within.get(r.osm)! } : r), osmBase }
}

/** One element, with what was measured about it. Exported for the tests, which build rows without files. */
export function rowOf(
  source: OsmSource, e: OsmElement,
  comuni: Readonly<Record<string, ComuneAnswer | null>>,
  terrain: Readonly<Record<string, Terrain>>,
  onPaths: ReadonlySet<string>,
): OsmRow {
  const id = osmId(e)
  const p = pointOf(e)
  const line = lineOf(e)
  return {
    osm: id, source, tags: e.tags ?? {},
    point: p && { lat: round5(p.lat), lon: round5(p.lon) },
    track: line.length >= 2 ? line.map(q => [round5(q.lat), round5(q.lon)] as const) : null,
    comune: id in comuni ? comuni[id] : undefined,
    terrain: terrain[id] ?? null,
    onMarkedPath: onPaths.has(id),
    area: null,
  }
}
