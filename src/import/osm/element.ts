/**
 * An OpenStreetMap element as Overpass returns it, and the two questions about
 * its shape that both the extract and the translator ask: where it is, and the
 * line it draws. Pure: no network, no database, no judgement about what the
 * element is.
 */

export interface LatLon { readonly lat: number; readonly lon: number }

export interface OsmMember {
  readonly type: string
  readonly ref?: number
  readonly role?: string
  readonly geometry?: readonly LatLon[]
}

export interface OsmElement {
  readonly type: 'node' | 'way' | 'relation'
  readonly id: number
  readonly tags?: Readonly<Record<string, string>>
  readonly lat?: number
  readonly lon?: number
  readonly center?: LatLon
  readonly geometry?: readonly LatLon[]
  readonly members?: readonly OsmMember[]
}

/** `n123`, `w456`, `r789`: the element's type and id, as osm.org's own short links write them. */
export const osmId = (e: Pick<OsmElement, 'type' | 'id'>): string => e.type.charAt(0) + e.id

/**
 * The line an element draws, in the order its ways come: a way's own
 * geometry, or a relation's member ways one after another. Empty for a node,
 * and for anything Overpass returned without geometry.
 */
export function lineOf(e: OsmElement): LatLon[] {
  if (e.geometry?.length) return [...e.geometry]
  return (e.members ?? [])
    .filter(m => m.type === 'way' && m.geometry?.length)
    .flatMap(m => [...m.geometry!])
}

/**
 * Where an element is, as one point.
 *
 * A node is where it is. A line — a route, a via ferrata, a ski tour — is
 * where it starts, its first point, since that is where somebody sets off
 * from (Phase 0 did the same). Anything else, a crag drawn as a cliff line or
 * an area, is its centre as Overpass computed it. Null when the element
 * carries none of these: then it is nowhere, and that is the translator's to
 * refuse, never this function's to guess.
 */
export function pointOf(e: OsmElement): LatLon | null {
  if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) return { lat: e.lat, lon: e.lon }
  const line = lineOf(e)
  if (line[0] && !isClimbing(e)) return line[0]
  if (e.center) return e.center
  return line[0] ?? null
}

/** A crag drawn as a line is a wall, not a way to follow: its centre is where it is. */
function isClimbing(e: OsmElement): boolean {
  return e.tags?.sport === 'climbing' || e.tags?.climbing !== undefined
}

/**
 * Every `step`-th point, the first and the last always kept. Applied to a
 * route's track so the extract stays small enough to keep in git; a page
 * draws it at the scale of a valley, where sixty points are plenty.
 */
export function thin<T>(points: readonly T[], keep: number): T[] {
  if (points.length <= keep) return [...points]
  const step = (points.length - 1) / (keep - 1)
  return Array.from({ length: keep }, (_, i) => points[Math.round(i * step)]!)
}
