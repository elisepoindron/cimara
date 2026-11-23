/**
 * The public demo's OpenStreetMap extract (the demo's plan,
 * Phase 2): Piemonte and Valle d'Aosta, read once from Overpass and written to
 * data/osm/extract/, with the comune each feature lies in and what the terrain
 * says about where it is.
 *
 *   node scripts/osm/extract.ts [--fresh]
 *
 * Run by hand, and only by hand: never at build, at start, at deploy or from
 * the seed. It calls three public services (Overpass twice over, Open-Meteo's
 * elevation API); everything downstream reads the files it wrote. A stage whose
 * file is already there is not asked again unless `--fresh` is given, so a run
 * that a busy server stopped halfway picks up where it was.
 *
 * What is written is what OpenStreetMap returned, with three exceptions, each
 * said in `manifest.json`:
 *   - links (`website`, `url`, `contact:website`, `source`) are dropped, and any
 *     tag whose value names the site the public demo must never name: some
 *     features link to it;
 *   - a route's ways are joined into one line on the route, thinned to sixty
 *     points and rounded to a metre, so the extract stays small enough to keep
 *     in git (member lists and bounds are dropped);
 *   - nothing else is touched: no tag is read, judged or filtered here.
 *
 * The comune is asked of OpenStreetMap too — the `admin_level=8` boundary that
 * contains the feature's point — never guessed from the nearest centroid. Height and aspect come from the terrain model behind Open-Meteo's
 * elevation API: the height at the point, and, for climbing features, which
 * way the ground faces, from four neighbours 60 m off.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineOf, osmId, pointOf, thin, type LatLon, type OsmElement } from '../../src/import/osm/element.ts'
import { aspectOf, type Terrain } from '../../src/import/osm/terrain.ts'
import { NEVER_NAMED } from '../../src/import/osm/never-named.ts'
import { comuneAt, ringsOf, type Boundary } from '../../src/import/osm/boundary.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'data', 'osm', 'extract')
const fresh = process.argv.includes('--fresh')

const UA = { 'User-Agent': 'osm-demo-extract/1.0' }
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const REGIONS = 'area["ISO3166-2"~"^IT-(21|23)$"]->.r;'
/** The provinces of the two regions, for the boundaries, asked one at a time. */
const PROVINCES: Record<string, string> = Object.fromEntries([
  ...['IT-23', 'IT-AL', 'IT-AT', 'IT-BI', 'IT-CN', 'IT-NO', 'IT-TO', 'IT-VB'].map(c => [c, `area["ISO3166-2"="${c}"]`]),
  // Vercelli's boundary carries no ISO 3166-2 code.
  ['VC', 'area["boundary"="administrative"]["admin_level"="6"]["name"="Vercelli"]'],
])
const HEAD = '[out:json][timeout:900];'

/** One Overpass query per feature type. The file name is what the translator reads it as. */
const QUERIES: Record<string, string> = {
  climbing: `${REGIONS}(nwr["sport"="climbing"](area.r);nwr["climbing"="crag"](area.r););out tags center;`,
  peaks: `${REGIONS}node["natural"="peak"](area.r);out;`,
  // The summits a marked path reaches: a node of one of a hiking route's
  // ways. Ids only; the peaks themselves are in peaks.json. (Within 50 m of a
  // way, with `around`, timed out on every public server.)
  'peaks-on-paths': `${REGIONS}rel["route"="hiking"](area.r)->.h;way(r.h)->.w;`
    + 'node(w.w)["natural"="peak"];out ids;',
  hiking: `${REGIONS}relation["route"="hiking"](area.r);out geom;`,
  via_ferrata: `${REGIONS}way["highway"="via_ferrata"](area.r);out geom;`,
  skitour: `${REGIONS}nwr["piste:type"="skitour"](area.r);out geom;`,
  mtb: `${REGIONS}relation["route"="mtb"](area.r);out geom;`,
}

const DROPPED_TAGS = new Set(['website', 'url', 'contact:website', 'source'])
/** Points kept of a route's line. */
const TRACK_POINTS = 60
const round5 = (x: number) => Math.round(x * 1e5) / 1e5

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const exists = (p: string) => stat(p).then(() => true, () => false)

/**
 * A POST with no timeout but ours. Node's own fetch gives up when a server
 * takes more than five minutes to send its headers, which a large Overpass
 * query often does: it surfaced as a bare "fetch failed".
 */
function post(url: string, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer in ${timeoutMs / 1000} s`)))
    req.on('error', reject)
    req.end(body)
  })
}

/** The public servers are often at capacity: they ask for a retry with a wait that doubles. */
async function overpass(query: string): Promise<{ osm3s?: { timestamp_osm_base?: string }; elements: OsmElement[] }> {
  for (let attempt = 0, wait = 10_000; attempt < 10; attempt++, wait = Math.min(wait * 2, 300_000)) {
    const url = SERVERS[attempt % SERVERS.length]!
    try {
      const res = await post(url, new URLSearchParams({ data: HEAD + query }).toString(), 950_000)
      if (res.status === 200 && res.text.startsWith('{')) {
        const json = JSON.parse(res.text)
        if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark)
        return json
      }
      console.error(`${url}: ${res.status} ${res.text.slice(0, 80).replace(/\s+/g, ' ')}`)
    } catch (err) {
      console.error(`${url}: ${(err as Error).message}`)
    }
    console.error(`  retrying in ${wait / 1000} s`)
    await sleep(wait)
  }
  throw new Error('every Overpass server refused, ten times')
}

function cleaned(e: OsmElement): OsmElement {
  const tags = e.tags && Object.fromEntries(Object.entries(e.tags)
    .filter(([k, v]) => !DROPPED_TAGS.has(k) && !NEVER_NAMED.test(v) && !NEVER_NAMED.test(k)))
  const { geometry: _g, members, bounds: _b, ...rest } = e as OsmElement & { bounds?: unknown }
  const line = lineOf(e)
  return {
    ...rest, ...(tags ? { tags } : {}),
    // A route's ways become one thinned line on the route itself. Its member
    // list is dropped, except that a route made only of other routes keeps
    // saying so: it has no line of its own.
    ...(line.length ? { geometry: thin(line, TRACK_POINTS).map(p => ({ lat: round5(p.lat), lon: round5(p.lon) })) }
      : members ? { members: members.map(({ type }) => ({ type })) } : {}),
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(join(OUT, name), JSON.stringify(value) + '\n')
}

await mkdir(OUT, { recursive: true })

// --- 1. The features, one query per type.
const features: Record<string, OsmElement[]> = {}
const stamps: Record<string, string> = {}
for (const [name, query] of Object.entries(QUERIES)) {
  const file = join(OUT, `${name}.json`)
  if (!fresh && await exists(file)) {
    const held = JSON.parse(await readFile(file, 'utf8'))
    features[name] = held.elements; stamps[name] = held.timestamp
    console.log(`${name}: ${held.elements.length}, kept from ${held.timestamp}`)
    continue
  }
  console.log(`${name}: asking Overpass…`)
  const res = await overpass(query)
  const elements = res.elements.map(cleaned)
  const timestamp = res.osm3s?.timestamp_osm_base ?? new Date().toISOString()
  await writeJson(`${name}.json`, { timestamp, query, elements })
  features[name] = elements; stamps[name] = timestamp
  console.log(`${name}: ${elements.length}`)
}

// --- 1b. The climbing areas a boulder may lie in: every climbing crag or area
// drawn as an outline, and every climbing relation (a site, a group, an
// area) with its members. Kept as ids and closed rings only: which boulder
// is in which area is decided in src/import/osm/areas.ts, from these and
// nothing else — never by how close boulders are to each other.
const areasFile = join(OUT, 'climbing-areas.json')
if (fresh || !await exists(areasFile)) {
  console.log('climbing-areas: asking Overpass…')
  const res = await overpass(`${REGIONS}(way["sport"="climbing"]["climbing"~"^(area|crag)$"](area.r);`
    + 'rel["sport"="climbing"](area.r);rel["site"="climbing"](area.r););out geom;')
  const r5 = (q: LatLon) => ({ lat: round5(q.lat), lon: round5(q.lon) })
  const areas = res.elements.map(e => {
    const ways = e.type === 'way' ? [e.geometry ?? []]
      : (e.members ?? []).filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry?.length).map(m => m.geometry!)
    return {
      osm: osmId(e),
      members: (e.members ?? []).filter(m => m.type !== 'way' || m.role !== 'outer').map(m => `${m.type[0]}${m.ref}`),
      rings: ringsOf(ways).map(r => r.map(r5)),
    }
  }).filter(a => a.members.length > 0 || a.rings.length > 0)
  await writeJson('climbing-areas.json', { timestamp: res.osm3s?.timestamp_osm_base ?? new Date().toISOString(), areas })
  stamps['climbing-areas'] = res.osm3s?.timestamp_osm_base ?? ''
  console.log(`climbing-areas: ${areas.length}`)
} else {
  const held = JSON.parse(await readFile(areasFile, 'utf8'))
  stamps['climbing-areas'] = held.timestamp
  console.log(`climbing-areas: ${held.areas.length}, kept from ${held.timestamp}`)
}

// Every feature with a point, once. Peak ids from peaks-on-paths are only ids.
const located = new Map<string, LatLon>()
for (const [name, elements] of Object.entries(features)) {
  if (name === 'peaks-on-paths') continue
  for (const e of elements) {
    const p = pointOf(e)
    if (p) located.set(osmId(e), p)
  }
}

// --- 2. The comune of every feature, from OpenStreetMap's own boundaries:
// the admin_level=8 relations of the two regions, with their geometry, asked
// province by province, and each point tested against them here. (One `is_in` per point, in
// batches, was the first way; the public servers could not keep up with it.)
// The boundaries themselves are not kept: comuni.json records the answers.
const comuniFile = join(OUT, 'comuni.json')
const comuni: Record<string, { name: string; istat: string | null } | null> =
  !fresh && await exists(comuniFile) ? JSON.parse(await readFile(comuniFile, 'utf8')).comuni : {}
const missing = [...located].filter(([id]) => !(id in comuni))
if (missing.length > 0) {
  // One province at a time, so each answer stays small; each is kept in
  // .cache/ (gitignored) until the run is over, so a stopped run resumes.
  const boundaries: Boundary[] = []
  const cache = join(OUT, '.cache')
  await mkdir(cache, { recursive: true })
  for (const [area, selector] of Object.entries(PROVINCES)) {
    const file = join(cache, `boundaries-${area}.json`)
    let held: Boundary[]
    if (await exists(file)) held = JSON.parse(await readFile(file, 'utf8'))
    else {
      console.log(`comuni: asking Overpass for the boundaries in ${area}…`)
      const res = await overpass(`${selector}->.p;rel["boundary"="administrative"]["admin_level"="8"](area.p);out geom;`)
      held = res.elements.filter(e => e.tags?.name).map(e => {
        const ways = (...roles: string[]) => (e.members ?? [])
          .filter(m => m.type === 'way' && roles.includes(m.role ?? '') && m.geometry?.length).map(m => m.geometry!)
        return { name: e.tags!.name!, istat: e.tags!['ref:ISTAT'] ?? null, outer: ringsOf(ways('outer', '')), inner: ringsOf(ways('inner')) }
      })
      if (held.length === 0) throw new Error(`no comuni in ${area}: does ${selector} name an area?`)
      await writeFile(file, JSON.stringify(held))
    }
    console.log(`comuni: ${area}, ${held.length} boundaries`)
    boundaries.push(...held)
  }
  console.log(`comuni: ${boundaries.length} boundaries, ${boundaries.filter(b => b.outer.length === 0).length} without a closed ring`)
  for (const [id, p] of missing) {
    const b = comuneAt(boundaries, p)
    comuni[id] = b && { name: b.name, istat: b.istat }
  }
  await writeJson('comuni.json', { asked: 'Overpass, admin_level=8 boundaries of the two regions, point in polygon', comuni })
  console.log(`comuni: ${Object.values(comuni).filter(Boolean).length} placed`)
}

// --- 3. The terrain: height everywhere, and the aspect where a wall is.
const terrainFile = join(OUT, 'terrain.json')
const terrain: Record<string, Terrain> =
  !fresh && await exists(terrainFile) ? JSON.parse(await readFile(terrainFile, 'utf8')).terrain : {}
const climbing = new Set(features.climbing.map(osmId))
const D = 60 / 111_000
// Not for summits, which carry their own height (`ele`), nor for hiking
// routes, whose start height is an optional fact: Open-Meteo counts every
// coordinate as a call, and the whole extract would be twice its daily
// allowance. A later run can add them; this stage resumes by id.
const measured = new Set([...features.climbing, ...features.via_ferrata, ...features.skitour].map(osmId))
const todo = [...located].filter(([id]) => measured.has(id) && !(id in terrain))
const samples: { id: string; points: [number, number][] }[] = todo.map(([id, p]) => {
  if (!climbing.has(id)) return { id, points: [[p.lat, p.lon]] }
  const k = D / Math.cos(p.lat * Math.PI / 180)
  return { id, points: [[p.lat, p.lon], [p.lat + D, p.lon], [p.lat - D, p.lon], [p.lat, p.lon + k], [p.lat, p.lon - k]] }
})
for (let i = 0; i < samples.length;) {
  // Up to a hundred coordinates per request, never splitting one feature's.
  const batch: typeof samples = []
  let n = 0
  while (i < samples.length && n + samples[i].points.length <= 100) { n += samples[i].points.length; batch.push(samples[i++]) }
  const all = batch.flatMap(s => s.points)
  const url = 'https://api.open-meteo.com/v1/elevation?' + new URLSearchParams({
    latitude: all.map(q => q[0].toFixed(6)).join(','), longitude: all.map(q => q[1].toFixed(6)).join(','),
  })
  let heights: number[] | null = null
  for (let attempt = 0, wait = 5_000; heights === null; attempt++, wait *= 2) {
    const res = await fetch(url, { headers: UA }).catch(() => null)
    if (res?.ok) heights = (await res.json() as { elevation: number[] }).elevation
    else if (attempt >= 10) throw new Error(`elevation: ${res?.status ?? 'no answer'}`)
    else {
      // 429: the minute's or the hour's allowance is spent. Wait it out.
      const pause = res?.status === 429 ? Math.min(60_000 * 2 ** attempt, 900_000) : wait
      console.error(`elevation: ${res?.status ?? 'no answer'}, retrying in ${pause / 1000} s`)
      await sleep(pause)
    }
  }
  let at = 0
  for (const s of batch) {
    const h = heights.slice(at, at + s.points.length); at += s.points.length
    terrain[s.id] = h.length === 5 ? aspectOf(h as [number, number, number, number, number], 60) : { ele: Math.round(h[0]) }
  }
  await writeJson('terrain.json', { asked: 'Open-Meteo elevation API (Copernicus DEM, 90 m)', terrain })
  console.log(`terrain: ${i} / ${samples.length}`)
  // Under 600 coordinates a minute and 5,000 an hour: about one request in 75 s.
  await sleep(75_000)
}

await writeJson('manifest.json', {
  regions: ['Piemonte (IT-21)', "Valle d'Aosta (IT-23)"],
  extracted: new Date().toISOString().slice(0, 10),
  osmBase: stamps,
  licence: '© OpenStreetMap contributors, ODbL. Heights: Copernicus DEM via Open-Meteo.',
  changes: [
    `tags dropped: ${[...DROPPED_TAGS].join(', ')}, and any tag naming a site the demo never names`,
    `a line's ways joined into one geometry of ${TRACK_POINTS} points, rounded to 5 decimals; member lists and bounds dropped`,
    'terrain measured for climbing, via ferrata and ski-touring features only (aspect for climbing); summits carry ele; hiking and mountain-bike routes are not measured',
  ],
  counts: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v.length])),
})
console.log('done:', OUT)
