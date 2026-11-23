import { distanceM, type Point } from './geo.ts'

/**
 * A walking path from the parking to the crag, as a hiking router found it on
 * mapped trails: the best path on the map, which is not always the way
 * climbers actually walk in. Coordinates are `[lon, lat]`, GeoJSON's order,
 * because that is the only thing they are ever handed to.
 */
export interface Trail {
  readonly coords: readonly (readonly [number, number])[]
  readonly lengthM: number
  /** null: the router gave no climb figure. */
  readonly ascentM: number | null
}

/**
 * How far either end of a trail may stop from the point it was asked for. A
 * router starts and ends on the nearest mapped path, and a car park or the
 * foot of a wall is often off one; the map draws those unmapped ends dotted,
 * as it draws a walk it knows nothing about. Beyond this the solid line would
 * mostly describe a walk to somewhere else.
 */
export const SNAP_M = 400

/**
 * How much longer than a straight line a trail may be before it is judged a
 * detour around a gap in the map rather than the walk in: four times the
 * crow's distance, plus a kilometre for short approaches that zigzag.
 */
export const DETOUR_FACTOR = 4
export const DETOUR_SLACK_M = 1000

const at = (c: readonly [number, number]): Point => ({ lat: c[1], lon: c[0] })

/**
 * Whether a router's trail can stand in for the walk from `from` to `to`:
 * both ends within SNAP_M of the points asked for, and no wild detour. A trail
 * that fails is not drawn; the map keeps its straight dashed line.
 */
export function trailJoins(trail: Trail, from: Point, to: Point): boolean {
  const first = trail.coords[0]
  const last = trail.coords[trail.coords.length - 1]
  if (trail.coords.length < 2 || !first || !last) return false
  if (distanceM(at(first), from) > SNAP_M || distanceM(at(last), to) > SNAP_M) return false
  return trail.lengthM <= DETOUR_FACTOR * distanceM(from, to) + DETOUR_SLACK_M
}

/** Walking speeds of the usual hiking rule (DIN 33466): on the flat, and climbing. */
export const FLAT_KM_PER_H = 4
export const CLIMB_M_PER_H = 300

/**
 * A walking time for a trail, in minutes rounded to five, by the hiking rule:
 * the longer of the flat time and the climbing time, plus half the shorter.
 * Only ever shown where the crag's own page gives no approach time: a time
 * written by people who walked it beats one worked out from a map.
 */
export function walkMinutes(trail: Trail): number {
  const flat = (trail.lengthM / 1000) / FLAT_KM_PER_H
  const climb = Math.max(0, trail.ascentM ?? 0) / CLIMB_M_PER_H
  const hours = Math.max(flat, climb) + Math.min(flat, climb) / 2
  return Math.max(5, Math.round(hours * 60 / 5) * 5)
}

/**
 * The point halfway along a trail by distance walked, where the approach
 * time's label sits: the midpoint of the two ends can lie off the path
 * entirely when the trail bends.
 */
export function halfwayAlong(coords: readonly (readonly [number, number])[]): [number, number] {
  const steps: number[] = []
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    const d = distanceM(at(coords[i - 1]!), at(coords[i]!))
    steps.push(d)
    total += d
  }
  let walked = 0
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    if (walked + step >= total / 2) {
      const f = step === 0 ? 0 : (total / 2 - walked) / step
      const a = coords[i]!
      const b = coords[i + 1]!
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
    walked += step
  }
  const only = coords[0]!
  return [only[0], only[1]]
}
