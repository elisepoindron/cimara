/**
 * Weather stations, as a route's page links to them. A station is somebody
 * else's measurement, published on its network's own page; the page names it,
 * says how far and how high it is, and links there. Nothing here reads a
 * figure from a station, and nothing compares one with the forecast.
 */

/** A network whose stations each have a public page, by the network's own code. */
export interface StationNetwork {
  /** Who measures, for the line under the list. */
  readonly source: string
  readonly pageOf: (code: string) => string
}

export const STATION_NETWORKS: Readonly<Record<string, StationNetwork>> = {
  'cf-vda': {
    source: 'Centro Funzionale della Valle d’Aosta',
    pageOf: code => `https://presidi2.regione.vda.it/str_dataview_station/${encodeURIComponent(code)}`,
  },
}

export interface NearbyStation {
  readonly network: string
  readonly code: string
  readonly name: string
  readonly altM: number
  readonly distanceM: number
}

/** How many the fold lists, nearest first. */
export const STATIONS_SHOWN = 3

/** How far a station may be and still be near: the source archive's lists reach about seven kilometres. */
export const STATION_RADIUS_M = 10_000

/** Its public page, or null for a network this registry does not know. */
export function stationPage(s: Pick<NearbyStation, 'network' | 'code'>): string | null {
  return STATION_NETWORKS[s.network]?.pageOf(s.code) ?? null
}

/**
 * Where a station stands against the route's own height: "125 m più in basso",
 * "40 m più in alto", "alla stessa quota" within 25 m. Null when the route
 * records no height to measure from.
 */
export function heightAgainst(stationM: number, routeM: number | null): string | null {
  if (routeM === null) return null
  const d = stationM - routeM
  if (Math.abs(d) < 25) return 'alla stessa quota'
  return `${Math.abs(d)} m ${d < 0 ? 'più in basso' : 'più in alto'}`
}
