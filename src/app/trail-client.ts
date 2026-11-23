import type { FetchTrail } from './trail.ts'
import type { Trail } from '../domain/trail.ts'

/**
 * BRouter's public server: a hiking router over OpenStreetMap's paths, free
 * and keyless, like the tile service the map already draws. Its data is
 * OpenStreetMap's, whose credit the map's own attribution already carries.
 */
const ENDPOINT = 'https://brouter.de/brouter'
/** The profile that follows marked mountain paths rather than roads. */
const PROFILE = 'hiking-mountain'
const TIMEOUT_MS = 15_000

export interface BrouterResponse {
  readonly features?: readonly {
    readonly geometry?: { readonly coordinates?: readonly (readonly number[])[] }
    readonly properties?: { readonly 'track-length'?: string; readonly 'filtered ascend'?: string }
  }[]
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

/**
 * One response, as the path the map draws: `[lon, lat]` pairs (BRouter adds
 * an elevation, which nothing here reads), rounded to about a metre. A
 * response without a line of at least two points, or without a length, is no
 * trail.
 */
export function trailFrom(data: BrouterResponse): Trail | null {
  const feature = data.features?.[0]
  const raw = feature?.geometry?.coordinates ?? []
  const coords = raw
    .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number')
    .map(c => [round5(c[0]!), round5(c[1]!)] as const)
  const lengthM = Number(feature?.properties?.['track-length'])
  if (coords.length < 2 || !Number.isFinite(lengthM)) return null
  const ascent = Number(feature?.properties?.['filtered ascend'])
  return { coords, lengthM, ascentM: Number.isFinite(ascent) ? ascent : null }
}

/** The real router, behind FetchTrail's seam in trail.ts. */
export const realFetchTrail: FetchTrail = async (from, to) => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('lonlats', `${from.lon},${from.lat}|${to.lon},${to.lat}`)
  url.searchParams.set('profile', PROFILE)
  url.searchParams.set('alternativeidx', '0')
  url.searchParams.set('format', 'geojson')

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  // BRouter answers "no route", and a search it gave up on for time, with a
  // 400 and a plain-text reason. Either is cached as no trail, which
  // trailFor asks about again the next day.
  if (res.status >= 400 && res.status < 500) return null
  if (!res.ok) throw new Error(`brouter answered ${res.status}`)
  return trailFrom(await res.json() as BrouterResponse)
}
