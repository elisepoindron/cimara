import { distanceM } from './geo.ts'
import type { Trail } from './trail.ts'

/**
 * One fix of a recorded track: `[lon, lat, ele]`, GeoJSON's order, since a map
 * is the only thing it is handed to. `ele` is null where the file gave none.
 */
export type TrackPoint = readonly [number, number, number | null]

/** A GPX file this module would not read, named by what was wrong with it. */
export class GpxRefused extends Error {}

const POINT = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
const attr = (attrs: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs)?.[1]
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * The points of a GPX file, in order: every track point of every segment, or,
 * in a file that holds only a planned route, its route points. Read with a
 * pattern, not a parser: GPX is flat, and the project takes no dependency for
 * it. A file with fewer than two points, or a point whose position is not a
 * position, is refused by name — a track is never patched into shape.
 */
export function readGpx(text: string): TrackPoint[] {
  const track: TrackPoint[] = []
  const routed: TrackPoint[] = []
  for (const m of text.matchAll(POINT)) {
    const [, tag, attrs = '', body = ''] = m
    const lat = Number(attr(attrs, 'lat'))
    const lon = Number(attr(attrs, 'lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new GpxRefused(`a ${tag} has no readable position: ${attrs.trim()}`)
    }
    const eleText = /<ele>\s*([^<]*?)\s*<\/ele>/.exec(body)?.[1]
    const ele = eleText === undefined || eleText === '' ? null : Number(eleText)
    const point: TrackPoint = [round6(lon), round6(lat), ele !== null && Number.isFinite(ele) ? Math.round(ele) : null]
    ;(tag === 'trkpt' ? track : routed).push(point)
  }
  const points = track.length > 0 ? track : routed
  if (points.length < 2) throw new GpxRefused(`a track needs at least two points, found ${points.length}`)
  return points
}

/**
 * How far the height has to turn before a climb is counted. A GPS's height
 * wanders a few metres either way at every fix; summing those would make a
 * flat walk climb hundreds of metres.
 */
export const ASCENT_THRESHOLD_M = 10

/**
 * The track as the map draws a walk: the line, how long it is, and how much it
 * climbs. The climb is counted only once the height has risen ASCENT_THRESHOLD_M
 * above its lowest since the last count, and is null where the file had no heights.
 */
export function trackTrail(points: readonly TrackPoint[]): Trail {
  let lengthM = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    lengthM += distanceM({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] })
  }

  const heights = points.map(p => p[2]).filter((h): h is number => h !== null)
  let ascentM: number | null = null
  if (heights.length >= 2) {
    ascentM = 0
    let low = heights[0]!
    let high = heights[0]!
    for (const h of heights.slice(1)) {
      if (h > high) high = h
      if (h < high - ASCENT_THRESHOLD_M) {
        // The climb from `low` to `high` is over: count it if it was one.
        if (high - low >= ASCENT_THRESHOLD_M) ascentM += high - low
        low = h
        high = h
      }
      if (h < low) { low = h; high = h }
    }
    if (high - low >= ASCENT_THRESHOLD_M) ascentM += high - low
  }

  return { coords: points.map(p => [p[0], p[1]] as const), lengthM, ascentM }
}

/**
 * Where the track goes highest — a hike's goal, whether it ends there or comes
 * back down another way. Where the file gave no heights at all (OpenStreetMap's
 * lines carry none), the point farthest from `from` — the parking, else where
 * the track starts: on a loop the last point is the first, and on a line
 * walked from its far end the last point is the car.
 */
export function trackGoal(
  points: readonly TrackPoint[], from: { lat: number; lon: number } | null = null,
): TrackPoint {
  if (points.some(p => p[2] !== null)) {
    let best = points[points.length - 1]!
    for (const p of points) if (p[2] !== null && (best[2] === null || p[2] > best[2])) best = p
    return best
  }
  const origin = from ?? { lat: points[0]![1], lon: points[0]![0] }
  let best = points[points.length - 1]!, far = -1
  for (const p of points) {
    const d = distanceM(origin, { lat: p[1], lon: p[0] })
    if (d > far) { far = d; best = p }
  }
  return best
}
