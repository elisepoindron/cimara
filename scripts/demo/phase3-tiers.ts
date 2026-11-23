/**
 * Chooses the public demo's archive and its tiers (Phase 3).
 *
 *   node scripts/demo/phase3-tiers.ts            # writes src/seed/sets/demo/tiers/tiers.json
 *
 * Reads data/osm/places.json (Phase 2's output) and nothing else, so the same
 * extract always gives the same selection. The stars are named by hand; every
 * other tier is chosen by prominence, never at random:
 *
 * - a place OpenStreetMap links to Wikidata or Wikipedia comes first;
 * - then one with more said about it (a description, both ends of a route, a
 *   distance, a difficulty scale, grades, a number of routes, a national or
 *   regional network);
 * - a place named only `Sentiero <ref>` comes after every named one, and a
 *   route with no name at all is never chosen.
 *
 * Within an activity the ranking alternates Piemonte and Valle d'Aosta in
 * proportion to what each holds, so a top tier is not all one region. The
 * places are dealt into tiers by fixed quotas per activity (QUOTAS below);
 * the lowest-ranked share of what is left is untouched rather than quiet.
 *
 * Bouldering is held back from every tier but the stars: another session is
 * regrouping single boulder problems under their areas in places.json, and its
 * ids will change. Its room in the total (~110 places) is left for it.
 * A sector of a star (`Palestra di roccia di Traversella: Settore …`) belongs
 * to the star's page and is not chosen on its own.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'src/seed/sets/demo/tiers/tiers.json')

interface Place {
  osm: string; activity: string; name: string; nameFrom: string
  comune: string; istat: string; hints: Record<string, string>; track: boolean
}

/** The ten the owner validated (2026-11-23). */
const STARS = [
  'w1096333248',  // Corno di Machaby, falesia, Arnad
  'n8090536385',  // Palestra di roccia di Traversella, falesia
  'n14112347108', // El Coup de Roure, falesia, Sampeyre
  'n8062483777',  // Via Yoghi, multipitch, Ceresole Reale
  'w670691556',   // Pietra Alta, bouldering, Caselette
  'w83688184',    // Via Ferrata Carlo Giorda, via_ferrata, Sant'Ambrogio di Torino
  'w627802454',   // Rifugio Deffeyes – Tête du Rutor, sci_alpinismo, La Thuile
  'r162371',      // Alta Via n. 2, tappa 10, escursionismo, Cogne
  'r2458709',     // Via Francigena, tappa 1 Valle d'Aosta, escursionismo, Saint-Oyen
  'r2545315',     // Jafferau, mountain_bike, Bardonecchia
]

/**
 * How many of each activity each tier takes; `rest` is how many more are
 * chosen at all, split between quiet and untouched by UNTOUCHED_SHARE. With
 * no alpinismo in the archive (Phase 0: a summit is not an itinerary), the
 * hikes take the summits' room.
 */
const QUOTAS: Record<string, { classic: number; regular: number; rest: number }> = {
  falesia:       { classic: 45, regular: 140, rest: Infinity },
  multipitch:    { classic: 12, regular: 20,  rest: Infinity },
  via_ferrata:   { classic: 12, regular: 17,  rest: Infinity },
  sci_alpinismo: { classic: 12, regular: 18,  rest: Infinity },
  mountain_bike: { classic: 14, regular: 40,  rest: Infinity },
  escursionismo: { classic: 55, regular: 365, rest: 1200 },
}
const UNTOUCHED_SHARE = 0.43

const GENERIC = /^Sentiero\b/

function score(p: Place): number {
  const h = p.hints
  let s = 0
  if (h.wikidata || h.wikipedia) s += 100
  if (h.description) s += 3
  if (h.from && h.to) s += 2
  if (h.distance) s += 1
  if (h.cai_scale || h.via_ferrata_scale || h['piste:difficulty'] || h['mtb:scale']) s += 1
  if (h.network === 'iwn' || h.network === 'nwn') s += 4
  else if (h.network === 'rwn') s += 2
  if (h['climbing:routes']) s += 3
  if (Object.keys(h).some(k => k.startsWith('climbing:grade'))) s += 2
  if (h['climbing:orientation'] || h['climbing:rock']) s += 1
  if (p.track) s += 1
  return s
}

const region = (p: Place) => p.istat.startsWith('007') ? 'Valle d’Aosta' : 'Piemonte'
const byRank = (a: Place, b: Place) =>
  (GENERIC.test(a.name) ? 1 : 0) - (GENERIC.test(b.name) ? 1 : 0)
  || score(b) - score(a)
  || a.name.localeCompare(b.name, 'it') || a.osm.localeCompare(b.osm)

/** One ranking per region, merged so each region keeps its share at every depth. */
function interleave(places: Place[]): Place[] {
  const lists = [...Map.groupBy(places, region).values()].map(l => l.sort(byRank))
  const total = places.length
  const taken = lists.map(() => 0)
  const out: Place[] = []
  while (out.length < total) {
    // The region furthest behind its share goes next.
    let best = -1, behind = -Infinity
    lists.forEach((l, i) => {
      if (taken[i] >= l.length) return
      const gap = (out.length + 1) * l.length / total - taken[i]
      if (gap > behind) { behind = gap; best = i }
    })
    out.push(lists[best][taken[best]++])
  }
  // Generic names stay last whatever their region.
  return [...out.filter(p => !GENERIC.test(p.name)), ...out.filter(p => GENERIC.test(p.name))]
}

/**
 * OpenStreetMap maps one named line as several ways (a ferrata's two halves, a piste in two
 * pieces). The same name, in the same activity, within 10 km of one already kept is that place
 * again: it is dropped, the better-ranked way stays. Never renamed: only the archive's own tags
 * may tell two places apart.
 */
function oneOfEach(ranked: Place[]): Place[] {
  const kept: Place[] = []
  for (const p of ranked) {
    const twin = kept.some(k => k.name === p.name && k.activity === p.activity && km(k, p) < 10)
    if (!twin) kept.push(p)
  }
  return kept
}
function km(a: Place, b: Place): number {
  const r = (x: number) => x * Math.PI / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

const { places } = JSON.parse(await readFile(join(ROOT, 'data/osm/places.json'), 'utf8')) as { places: Place[] }
const byId = new Map(places.map(p => [p.osm, p]))
const stars = STARS.map(id => byId.get(id) ?? (() => { throw new Error(`star ${id} is not in places.json`) })())
const starNames = stars.map(s => s.name)

const tiers: Record<string, Place[]> = { star: stars, classic: [], regular: [], quiet: [], untouched: [] }
for (const [activity, q] of Object.entries(QUOTAS)) {
  const pool = oneOfEach(interleave(places.filter(p =>
    p.activity === activity
    && p.nameFrom === 'name'
    && !STARS.includes(p.osm)
    && !starNames.some(n => p.name.startsWith(`${n}:`)))))
  const classic = pool.slice(0, q.classic)
  const regular = pool.slice(q.classic, q.classic + q.regular)
  const rest = pool.slice(q.classic + q.regular, q.classic + q.regular + q.rest)
  const quietCount = Math.round(rest.length * (1 - UNTOUCHED_SHARE))
  tiers.classic.push(...classic)
  tiers.regular.push(...regular)
  tiers.quiet.push(...rest.slice(0, quietCount))
  tiers.untouched.push(...rest.slice(quietCount))
}

const entry = (p: Place) => ({ osm: p.osm, activity: p.activity, name: p.name, comune: p.comune })
const counts: Record<string, Record<string, number>> = {}
for (const [tier, list] of Object.entries(tiers)) {
  for (const p of list) {
    counts[p.activity] ??= {}
    counts[p.activity][tier] = (counts[p.activity][tier] ?? 0) + 1
  }
}
const regions: Record<string, number> = {}
for (const list of Object.values(tiers)) for (const p of list) regions[region(p)] = (regions[region(p)] ?? 0) + 1

const doc = {
  about: 'The public demo’s archive and its tiers, chosen by scripts/demo/phase3-tiers.ts from data/osm/places.json. Do not edit by hand: change the script and run it again.',
  extracted: JSON.parse(await readFile(join(ROOT, 'data/osm/places.json'), 'utf8')).extracted,
  heldBack: 'bouldering, outside the stars, until its areas are regrouped in places.json',
  total: Object.values(tiers).reduce((n, l) => n + l.length, 0),
  counts,
  regions,
  tiers: Object.fromEntries(Object.entries(tiers).map(([t, l]) => [t, l.map(entry)])),
}

await mkdir(dirname(OUT), { recursive: true })
// One place per line, so a diff says which places moved.
const lines = JSON.stringify(doc, null, 2).replace(/\{\s+"osm": ([^}]*?)\s+\}/g,
  (_, body: string) => `{ "osm": ${body.replace(/,\s+/g, ', ')} }`)
await writeFile(OUT, lines + '\n')
console.log(`${doc.total} places`, counts, regions)
