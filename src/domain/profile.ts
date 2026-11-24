import { distanceM } from './geo.ts'
import type { TrackPoint } from './track.ts'

/**
 * A route's elevation profile, as arithmetic over a line and the ground under
 * it. The line is the route's recorded track; its heights and the angle of the
 * ground beside it are read from a terrain model, never from the GPS, whose
 * heights wander and would add up to a climb nobody made. Nothing here
 * fetches: the caller hands over a way to read the ground and gets numbers back.
 */

/** How far apart the profile reads the ground along the line. */
export const STEP_M = 15

/**
 * The ground's angle is the steepest way down at a point, from its height a
 * little east and west, a little north and south. This is that little.
 */
export const SLOPE_REACH_M = 15

/** The ground's angle is averaged over this much either side, so one boulder is not a cliff. */
export const SLOPE_SMOOTH_M = 45

/** The path's gradient is measured over this much either side: a stretch, not a step. */
export const GRADE_REACH_M = 150

/** A point on the line, so many metres from its start. */
export interface LinePoint {
  readonly d: number
  readonly lat: number
  readonly lon: number
}

/**
 * One reading of the profile: metres from the start, metres high, the ground's
 * angle in degrees, and the path's gradient in per cent (positive uphill).
 */
export interface ProfileSample {
  readonly d: number
  readonly e: number
  readonly s: number
  readonly g: number
}

/** The ground's height at a point, or null where the terrain could not be read. */
export type HeightAt = (lat: number, lon: number) => number | null

const M_PER_DEG_LAT = Math.PI * 6_371_000 / 180

/**
 * The line again, with a point every `stepM` metres along it and its very end.
 * A recorded track's fixes are as far apart as the GPS chose; a profile reads
 * the ground at an even pace.
 */
export function resample(points: readonly TrackPoint[], stepM = STEP_M): LinePoint[] {
  if (points.length === 0) return []
  const first = points[0]!
  const out: LinePoint[] = [{ d: 0, lat: first[1], lon: first[0] }]
  let walked = 0
  let next = stepM
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const leg = distanceM({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] })
    while (leg > 0 && next <= walked + leg) {
      const k = (next - walked) / leg
      out.push({ d: next, lat: a[1] + (b[1] - a[1]) * k, lon: a[0] + (b[0] - a[0]) * k })
      next += stepM
    }
    walked += leg
  }
  const last = points[points.length - 1]!
  if (walked - out[out.length - 1]!.d > 0.5) out.push({ d: walked, lat: last[1], lon: last[0] })
  return out
}

/** The ground's angle at a point, in degrees; null where any of its four neighbours cannot be read. */
export function groundAngle(lat: number, lon: number, heightAt: HeightAt, reachM = SLOPE_REACH_M): number | null {
  const dLat = reachM / M_PER_DEG_LAT
  const dLon = reachM / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
  const east = heightAt(lat, lon + dLon), west = heightAt(lat, lon - dLon)
  const north = heightAt(lat + dLat, lon), south = heightAt(lat - dLat, lon)
  if (east === null || west === null || north === null || south === null) return null
  const ex = (east - west) / (2 * reachM)
  const ey = (north - south) / (2 * reachM)
  return Math.atan(Math.hypot(ex, ey)) * 180 / Math.PI
}

/** The height along a profile at `d` metres, between its readings. */
export function heightAlong(samples: readonly { d: number; e: number }[], d: number): number {
  const first = samples[0]!, last = samples[samples.length - 1]!
  if (d <= first.d) return first.e
  if (d >= last.d) return last.e
  let lo = 0, hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid]!.d < d) lo = mid; else hi = mid
  }
  const a = samples[lo]!, b = samples[hi]!
  return a.e + (b.e - a.e) * (d - a.d) / ((b.d - a.d) || 1)
}

/** The path's gradient at `d`, in per cent, over GRADE_REACH_M either side (less at the ends). */
export function gradeAt(samples: readonly { d: number; e: number }[], d: number, reachM = GRADE_REACH_M): number {
  const length = samples[samples.length - 1]!.d
  const a = Math.max(0, d - reachM), b = Math.min(length, d + reachM)
  if (b - a <= 0) return 0
  return (heightAlong(samples, b) - heightAlong(samples, a)) / (b - a) * 100
}

/**
 * A line's profile over the ground: its height, the ground's angle (averaged
 * over SLOPE_SMOOTH_M either side) and the path's gradient, every STEP_M.
 * null where the ground could not be read at some point: a profile with a hole
 * is not drawn, never patched.
 */
export function profileOf(points: readonly TrackPoint[], heightAt: HeightAt): ProfileSample[] | null {
  if (points.length < 2) return null
  const line = resample(points)
  if (line.length < 2) return null
  const raw: { d: number; e: number; s: number }[] = []
  for (const p of line) {
    const e = heightAt(p.lat, p.lon)
    const s = groundAngle(p.lat, p.lon, heightAt)
    if (e === null || s === null) return null
    raw.push({ d: p.d, e, s })
  }
  return raw.map((p, i) => {
    let sum = 0, n = 0
    for (let j = i; j >= 0 && p.d - raw[j]!.d <= SLOPE_SMOOTH_M; j--) { sum += raw[j]!.s; n++ }
    for (let j = i + 1; j < raw.length && raw[j]!.d - p.d <= SLOPE_SMOOTH_M; j++) { sum += raw[j]!.s; n++ }
    return {
      d: Math.round(p.d),
      e: Math.round(p.e),
      s: Math.round(sum / n),
      g: Math.round(gradeAt(raw, p.d)),
    }
  })
}

/**
 * The climb along a profile, every rise added up. The terrain is smooth where
 * a GPS is not, so this comes close to the sheet's figure; the page prints the
 * sheet's own, and this only where the sheet has none.
 */
export function climbOf(samples: readonly ProfileSample[]): number {
  let up = 0
  for (let i = 1; i < samples.length; i++) up += Math.max(0, samples[i]!.e - samples[i - 1]!.e)
  return Math.round(up)
}
