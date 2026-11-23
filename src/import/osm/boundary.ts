import type { LatLon } from './element.ts'

/**
 * A comune as OpenStreetMap draws it: its name, its ISTAT code, and the
 * closed rings of its boundary relation — outer rings, and the inner rings
 * (enclaves of another comune) cut out of them.
 */
export interface Boundary {
  readonly name: string
  readonly istat: string | null
  readonly outer: readonly (readonly LatLon[])[]
  readonly inner: readonly (readonly LatLon[])[]
}

const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon

/**
 * The closed rings a set of ways makes, joined end to end, either way round,
 * as a multipolygon relation lists them in no promised order. A chain that
 * never closes (a boundary cut by the edge of the query) is dropped: a ring
 * that is not closed contains nothing.
 */
export function ringsOf(ways: readonly (readonly LatLon[])[]): LatLon[][] {
  const open = ways.filter(w => w.length >= 2).map(w => [...w])
  const rings: LatLon[][] = []
  while (open.length > 0) {
    let ring = open.shift()!
    for (let grew = true; grew && !same(ring[0]!, ring.at(-1)!);) {
      grew = false
      for (let i = 0; i < open.length; i++) {
        const w = open[i]!
        const end = ring.at(-1)!, start = ring[0]!
        if (same(end, w[0]!)) ring = [...ring, ...w.slice(1)]
        else if (same(end, w.at(-1)!)) ring = [...ring, ...w.slice(0, -1).reverse()]
        else if (same(start, w.at(-1)!)) ring = [...w.slice(0, -1), ...ring]
        else if (same(start, w[0]!)) ring = [...w.slice(1).reverse(), ...ring]
        else continue
        open.splice(i, 1)
        grew = true
        break
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring.at(-1)!)) rings.push(ring)
  }
  return rings
}

/** Ray casting: whether a point lies inside a closed ring. */
export function inRing(p: LatLon, ring: readonly LatLon[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a.lat > p.lat) !== (b.lat > p.lat)
        && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

export function contains(b: Boundary, p: LatLon): boolean {
  return b.outer.some(r => inRing(p, r)) && !b.inner.some(r => inRing(p, r))
}

/** The comune that contains a point, or null where none of those given does. */
export function comuneAt(boundaries: readonly Boundary[], p: LatLon): Boundary | null {
  return boundaries.find(b => contains(b, p)) ?? null
}
