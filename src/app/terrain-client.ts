import type { FetchTile } from './terrain.ts'

/**
 * The terrain tiles on AWS's open data registry (Mapzen's Terrain Tiles):
 * keyless, in the terrarium encoding, and served as PNG, which Node reads with
 * its own zlib.
 * Attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
 */
const ENDPOINT = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const TIMEOUT_MS = 15_000

export const fetchTerrainTile: FetchTile = async (z, x, y) => {
  const res = await fetch(`${ENDPOINT}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`terrain tile ${z}/${x}/${y}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
