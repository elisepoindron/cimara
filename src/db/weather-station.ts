import type { Db } from './open.ts'
import { boundingBox, distanceM, type Point } from '../domain/geo.ts'
import type { NearbyStation } from '../domain/stations.ts'

export interface NewWeatherStation {
  readonly network: string
  readonly code: string
  readonly name: string
  readonly altM: number
  readonly lat: number
  readonly lon: number
}

/** Keyed by the network's own code: seeding again leaves a known station as it is. */
export async function insertWeatherStation(db: Db, s: NewWeatherStation): Promise<boolean> {
  const before = await db.get<{ n: number }>('select count(*) as n from weather_station where network = ? and code = ?',
    [s.network, s.code])
  if ((before?.n ?? 0) > 0) return false
  await db.run(`insert into weather_station (network, code, name, alt_m, lat, lon) values (?, ?, ?, ?, ?, ?)`,
    [s.network, s.code, s.name, s.altM, s.lat, s.lon])
  return true
}

/**
 * The stations within `withinM` of a point, nearest first, at most `limit`.
 * SQL narrows to the bounding box; the true distance decides.
 */
export async function stationsNear(db: Db, of: Point, withinM: number, limit: number): Promise<NearbyStation[]> {
  const box = boundingBox(of, withinM)
  const rows = await db.all<{ network: string; code: string; name: string; alt_m: number; lat: number; lon: number }>(`
    select network, code, name, alt_m, lat, lon from weather_station
    where lat between ? and ? and lon between ? and ?`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon])

  return rows
    .map(r => ({ network: r.network, code: r.code, name: r.name, altM: r.alt_m,
                 distanceM: distanceM(of, { lat: r.lat, lon: r.lon }) }))
    .filter(s => s.distanceM <= withinM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit)
}
