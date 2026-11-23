export interface Point {
  readonly lat: number
  readonly lon: number
}

const EARTH_M = 6_371_000
const RAD = Math.PI / 180

/**
 * Great-circle distance in metres. Within half a percent of a true geodesic at
 * any distance this project asks about, which is noise against a five-kilometre
 * threshold chosen by feel.
 */
export function distanceM(a: Point, b: Point): number {
  const lat1 = a.lat * RAD
  const lat2 = b.lat * RAD
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD

  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return Math.round(2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h))))
}

/**
 * A latitude/longitude box that certainly contains every point within `radiusM`.
 * It also contains points beyond it, at the corners — this is a cheap prefilter
 * for an index, and `distanceM` decides the real answer.
 */
export function boundingBox(centre: Point, radiusM: number): {
  minLat: number; maxLat: number; minLon: number; maxLon: number
} {
  const dLat = (radiusM / EARTH_M) / RAD
  const dLon = dLat / Math.max(Math.cos(centre.lat * RAD), 1e-6)
  return {
    minLat: centre.lat - dLat, maxLat: centre.lat + dLat,
    minLon: centre.lon - dLon, maxLon: centre.lon + dLon,
  }
}

/**
 * An itinerary's two access points, the parking and its own, with its own
 * left out where it is the parking itself. The source archive records one point for
 * a multi-pitch, where the walk starts; seeded as the parking and as the
 * route's own location, it says nothing about where the climbing starts, so
 * the page draws that as unrecorded rather than as a second pin on the first.
 */
export function accessPoints(it: {
  readonly lat: number | null; readonly lon: number | null
  readonly parkingLat: number | null; readonly parkingLon: number | null
}): { parking: Point | null; own: Point | null } {
  const parking = it.parkingLat !== null && it.parkingLon !== null ? { lat: it.parkingLat, lon: it.parkingLon } : null
  const own = it.lat !== null && it.lon !== null ? { lat: it.lat, lon: it.lon } : null
  const same = parking !== null && own !== null && parking.lat === own.lat && parking.lon === own.lon
  return { parking, own: same ? null : own }
}
