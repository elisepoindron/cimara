import { inRing } from './boundary.ts'
import type { LatLon } from './element.ts'

/**
 * A climbing area as OpenStreetMap records it: a crag or area drawn as an
 * outline, or a climbing relation (a site, a group, an area) listing its
 * members. scripts/osm/extract.ts writes these to climbing-areas.json.
 */
export interface ClimbingArea {
  readonly osm: string
  /** Its members' ids (`n123`, `w456`, `r789`), outline ways left out. */
  readonly members: readonly string[]
  /** Its closed outer rings, where it is drawn as an outline. */
  readonly rings: readonly (readonly LatLon[])[]
}

/**
 * The area each boulder lies in, by what OpenStreetMap says and nothing else:
 * an area that lists the boulder as a member first, then the smallest outline
 * that contains its point. A boulder no area lists or contains has none here —
 * nearness to other boulders is never taken for an area nobody drew.
 */
export function areaOf(
  boulders: readonly { readonly osm: string; readonly point: LatLon | null }[],
  areas: readonly ClimbingArea[],
): Map<string, string> {
  const byMember = new Map<string, string>()
  for (const a of areas) for (const m of a.members) if (m !== a.osm && !byMember.has(m)) byMember.set(m, a.osm)
  const outlined = areas.filter(a => a.rings.length > 0)
    .map(a => ({ osm: a.osm, rings: a.rings, size: Math.min(...a.rings.map(ringSize)) }))
    .sort((x, y) => x.size - y.size)

  const found = new Map<string, string>()
  for (const b of boulders) {
    const member = byMember.get(b.osm)
    if (member !== undefined) { found.set(b.osm, member); continue }
    if (b.point === null) continue
    const around = outlined.find(a => a.osm !== b.osm && a.rings.some(r => inRing(b.point!, r)))
    if (around) found.set(b.osm, around.osm)
  }
  return found
}

/** A ring's area in square degrees: only ever compared with another's. */
function ringSize(ring: readonly LatLon[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j]!.lon + ring[i]!.lon) * (ring[j]!.lat - ring[i]!.lat)
  }
  return Math.abs(s / 2)
}
