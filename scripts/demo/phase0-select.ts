/**
 * Phase 0 of the public demo:
 * the twenty places of the test batch, read from OpenStreetMap, with what the
 * terrain says about each. A spike, not the importer: it exists to find out
 * what the importer will need.
 *
 *   node scripts/demo/phase0-select.ts <osm-extract.json> <out.json>
 *
 * The extract is an Overpass `out tags center` over the lower Aosta valley.
 * Each place gets its comune from OpenStreetMap's own boundaries (never the
 * nearest centroid), its height and the way its slope faces from the terrain
 * model behind Open-Meteo's elevation API, and, for a route, its start point
 * and a thinned track. Links (`website`, `url`) are dropped: some point at the
 * site the public demo must never name.
 */
import { readFile, writeFile } from 'node:fs/promises'

const [extractPath, outPath, picksPath] = process.argv.slice(2)
if (!extractPath || !outPath) throw new Error('usage: phase0-select.ts <osm-extract.json> <out.json> [picks.json]')

type Tier = 'star' | 'classic' | 'regular' | 'quiet' | 'untouched'
/** The test batch's twenty, unless a picks file lists others as [tier, activity, osm id]. */
const PICK: [Tier, string, string][] = picksPath ? JSON.parse(await readFile(picksPath, 'utf8')) : [
  ['star', 'falesia', 'w1096333248'],
  ['classic', 'falesia', 'w1116939649'], ['classic', 'via_ferrata', 'w1001175753'], ['classic', 'escursionismo', 'r12574561'],
  ['regular', 'falesia', 'w797136964'], ['regular', 'falesia', 'w826855376'], ['regular', 'falesia', 'n9900310752'],
  ['regular', 'escursionismo', 'r13571794'], ['regular', 'via_ferrata', 'w866910362'],
  ['quiet', 'falesia', 'n6695502538'], ['quiet', 'falesia', 'n6695502537'], ['quiet', 'falesia', 'n6697116671'],
  ['quiet', 'falesia', 'n13900003782'], ['quiet', 'falesia', 'w1001175757'], ['quiet', 'escursionismo', 'r14737150'],
  ['untouched', 'falesia', 'n13902986460'], ['untouched', 'falesia', 'w1089086956'], ['untouched', 'escursionismo', 'r14704089'],
  ['untouched', 'sci_alpinismo', 'r8240245'], ['untouched', 'falesia', 'n13902986461'],
]
const UA = { 'User-Agent': 'osm-demo-script/1.0' }
const DROPPED_TAGS = new Set(['website', 'url', 'source', 'contact:website'])

interface OsmElement {
  type: 'node' | 'way' | 'relation'; id: number; tags: Record<string, string>
  lat?: number; lon?: number; center?: { lat: number; lon: number }
  members?: { type: string; geometry?: { lat: number; lon: number }[] }[]
}

/** The public servers are often at capacity: they ask for a retry with a wait that doubles. */
async function overpass(query: string): Promise<OsmElement[]> {
  const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
  for (let attempt = 0, wait = 5_000; attempt < 6; attempt++, wait *= 2) {
    const url = servers[attempt % servers.length]
    const res = await fetch(url, { method: 'POST', headers: UA, body: new URLSearchParams({ data: query }) })
      .catch(err => ({ ok: false, status: String(err) }) as const)
    if (res.ok) return (await (res as Response).json() as { elements: OsmElement[] }).elements
    console.error(`${url}: ${res.status}, retrying in ${wait / 1000} s`)
    await new Promise(r => setTimeout(r, wait))
  }
  throw new Error('every Overpass server refused, six times')
}

const extract = JSON.parse(await readFile(extractPath, 'utf8')) as { elements: OsmElement[] }
const byId = new Map(extract.elements.map(e => [e.type[0] + e.id, e]))

const relIds = PICK.filter(([, , id]) => id.startsWith('r')).map(([, , id]) => id.slice(1))
const routes = new Map((await overpass(`[out:json];relation(id:${relIds.join(',')});out geom;`)).map(e => [e.id, e]))

const round5 = (x: number) => Math.round(x * 1e5) / 1e5
const places = PICK.map(([tier, activity, id]) => {
  const e = byId.get(id)
  if (!e) throw new Error(`${id} is not in the extract`)
  let lat: number, lon: number, track: [number, number][] | null = null
  if (e.type === 'relation') {
    const ways = (routes.get(e.id)?.members ?? []).filter(m => m.type === 'way' && m.geometry?.length)
    if (ways.length === 0) throw new Error(`${id}: a route with no ways`)
    const points = ways.flatMap(m => m.geometry!)
    ;({ lat, lon } = points[0])
    const step = Math.max(1, Math.floor(points.length / 60))
    track = points.filter((_, i) => i % step === 0).map(p => [round5(p.lat), round5(p.lon)])
  } else {
    const c = e.center ?? { lat: e.lat!, lon: e.lon! }
    ;({ lat, lon } = c)
  }
  const tags = Object.fromEntries(Object.entries(e.tags).filter(([k]) => !DROPPED_TAGS.has(k)))
  return { osm: id, tier, activity, name: e.tags.name ?? null, lat: round5(lat), lon: round5(lon), tags, track,
           comune: null as string | null, istat: null as string | null,
           eleDem: 0, aspectDem: '', slopeDeg: 0 }
})

// The comune is the admin_level=8 area OpenStreetMap says contains the point.
const areaQuery = '[out:json][timeout:120];' + places.map((p, i) =>
  `is_in(${p.lat},${p.lon})->.a${i};area.a${i}["admin_level"="8"];out tags;`).join('')
const areas = await overpass(areaQuery)
if (areas.length !== places.length) throw new Error(`expected ${places.length} comuni, got ${areas.length}`)
places.forEach((p, i) => { p.comune = areas[i].tags.name ?? null; p.istat = areas[i].tags['ref:ISTAT'] ?? null })

// Height at the point, and which way the ground faces, from four neighbours 60 m off.
const D = 60 / 111_000
const queries = places.flatMap(p => {
  const k = D / Math.cos(p.lat * Math.PI / 180)
  return [[p.lat, p.lon], [p.lat + D, p.lon], [p.lat - D, p.lon], [p.lat, p.lon + k], [p.lat, p.lon - k]]
})
const heights: number[] = []
for (let i = 0; i < queries.length; i += 100) {
  const chunk = queries.slice(i, i + 100)
  const url = 'https://api.open-meteo.com/v1/elevation?' + new URLSearchParams({
    latitude: chunk.map(q => q[0].toFixed(6)).join(','), longitude: chunk.map(q => q[1].toFixed(6)).join(','),
  })
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`elevation: ${res.status}`)
  heights.push(...(await res.json() as { elevation: number[] }).elevation)
}
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
places.forEach((p, i) => {
  const [h, n, s, e, w] = heights.slice(5 * i, 5 * i + 5)
  const dzdx = (e - w) / 120, dzdy = (n - s) / 120
  const facing = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360
  p.eleDem = Math.round(h)
  p.slopeDeg = Math.round(Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI)
  p.aspectDem = DIRS[Math.round(facing / 45) % 8]
})

await writeFile(outPath, JSON.stringify(places, null, 1) + '\n')
for (const p of places) {
  console.log([p.tier, p.activity, p.name, p.comune, p.istat, `${p.eleDem} m`, p.aspectDem, `${p.slopeDeg}°`,
               p.tags['climbing:orientation'] ?? ''].join(' | '))
}
