/**
 * Checks the public demo's written content before it is loaded (Phases 0 and 3).
 *
 *   node scripts/demo/phase0-check.ts <file.json>…
 *
 * Says every problem it finds, by file and field, and exits 1 if there is one.
 * It checks what the seed and the reading would otherwise throw away quietly:
 * a quote that is not in its report's words, a reading out of step with its
 * reports, a fact or a section the activity does not have, a value its
 * quantity cannot hold, and the one name the demo must never say.
 *
 * What an activity holds is read from the app's own registry
 * (src/domain/activities/), so a fact or a section is accepted exactly when
 * the page would draw it. Where the place is in data/osm/places.json, the file
 * must agree with what was measured there unless it lists the fact as
 * invented; where it is in the tiers file, its reports must fit the tier.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIVITIES } from '../../src/domain/activities/index.ts'
import { storedProse, type FactDef } from '../../src/domain/registry.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The activities the demo's archive holds: what OpenStreetMap gives (Phase 2). */
const DEMO_ACTIVITIES = new Set(['falesia', 'multipitch', 'bouldering', 'escursionismo', 'via_ferrata', 'sci_alpinismo', 'mountain_bike'])
/** A French sport grade as a number to compare: 3 < 4a < 4b < 4b+ < 4c … */
function frenchRank(g: string): number | undefined {
  const m = /^(\d)([abc])?(\+)?$/.exec(g.trim())
  return m ? Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) * 2 + (m[3] ? 1 : 0) : undefined
}
const DAY = /^\d{4}-\d{2}-\d{2}$/
const FIRST_DAY = '2022-03-01', LAST_DAY = '2026-11-15'
const { NEVER_NAMED: FORBIDDEN } = await import('../../src/import/osm/never-named.ts')

/** Reports a tier holds (the plan's table). */
const TIER_REPORTS: Record<string, [number, number]> = {
  star: [40, 60], classic: [15, 25], regular: [4, 8], quiet: [1, 3], untouched: [0, 0],
}

const placesFile = JSON.parse(await readFile(join(ROOT, 'data/osm/places.json'), 'utf8')) as {
  places: { osm: string; lat: number; lon: number; istat: string; activity: string; name: string
    measured: Record<string, { value: unknown }>; hints?: Record<string, string> }[]
}
const measuredPlaces = new Map(placesFile.places.map(p => [p.osm, p]))
const tierOf = new Map<string, string>()
const tiers = await readFile(join(ROOT, 'src/seed/sets/demo/tiers/tiers.json'), 'utf8').then(JSON.parse, () => null)
for (const [tier, list] of Object.entries((tiers?.tiers ?? {}) as Record<string, { osm: string }[]>)) {
  for (const p of list) tierOf.set(p.osm, tier)
}

let problems = 0
const problem = (file: string, field: string, what: string) => {
  problems++
  console.log(`${file}: ${field}: ${what}`)
}

/** Parses a value with its fact's quantity; the message when it cannot. */
function unreadable(def: FactDef, value: unknown): string | null {
  try { def.quantity.parse(value); return null } catch (err) { return (err as Error).message }
}

/** Two files may not share an itinerary name: the seed would take one for the other (the build refuses it too). */
const namedBy = new Map<string, string>()

for (const path of process.argv.slice(2)) {
  const file = basename(path)
  const text = await readFile(path, 'utf8')
  if (FORBIDDEN.test(text)) problem(file, '(anywhere)', 'names the site the demo must never name')
  let doc: any
  try { doc = JSON.parse(text) } catch (err) { problem(file, '(file)', `not JSON: ${(err as Error).message}`); continue }

  const it = doc.itinerary ?? {}
  const invented = new Set<string>(Array.isArray(doc.invented) ? doc.invented : [])
  if (!Array.isArray(doc.invented)) problem(file, 'invented', 'expected a list of what was made up')
  if (typeof doc.osm !== 'string') problem(file, 'osm', 'missing')
  else if (file !== `${doc.osm}.json`) problem(file, 'osm', `the file should be named ${doc.osm}.json`)
  if (!DEMO_ACTIVITIES.has(it.activity)) { problem(file, 'itinerary.activity', `not one of the demo's: ${it.activity}`); continue }
  const schema = ACTIVITIES[it.activity]
  if (typeof it.key !== 'string' || !/^[a-z0-9-]+$/.test(it.key)) problem(file, 'itinerary.key', `expected a slug, found ${it.key}`)
  if (typeof it.place !== 'string' || !/^comune-\d{6}$/.test(it.place)) problem(file, 'itinerary.place', `expected comune-NNNNNN, found ${it.place}`)
  if (typeof it.name !== 'string' || it.name.trim() === '') problem(file, 'itinerary.name', 'missing')
  else {
    const other = namedBy.get(it.name)
    if (other !== undefined) problem(file, 'itinerary.name', `${it.name} is already ${other}'s: one place mapped twice is one file; never an invented suffix`)
    else namedBy.set(it.name, file)
  }
  if (it.aspect !== undefined && !['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].includes(it.aspect)) problem(file, 'itinerary.aspect', `found ${it.aspect}`)

  // What OpenStreetMap measured is not rewritten.
  const measured = measuredPlaces.get(doc.osm)
  if (!measured) problem(file, 'osm', `${doc.osm} is not in data/osm/places.json`)
  else {
    if (measured.activity !== it.activity) problem(file, 'itinerary.activity', `OpenStreetMap says ${measured.activity}`)
    if (it.place !== `comune-${measured.istat}`) problem(file, 'itinerary.place', `the place is in comune-${measured.istat}`)
    if (it.lat !== measured.lat || it.lon !== measured.lon) problem(file, 'itinerary.lat/lon', `measured ${measured.lat}, ${measured.lon}`)
    for (const [k, m] of Object.entries(measured.measured)) {
      if (invented.has(k)) continue
      if (it.facts?.[k] !== m.value) problem(file, `facts.${k}`, `measured ${JSON.stringify(m.value)}, found ${JSON.stringify(it.facts?.[k])}`)
    }
  }

  // Facts: those the activity declares, each readable by its quantity.
  const facts = it.facts ?? {}
  const defs = new Map([...schema.facts, ...(schema.access ?? [])].map(f => [f.id, f]))
  for (const [k, v] of Object.entries(facts)) {
    const def = defs.get(k)
    if (!def) { problem(file, `facts.${k}`, `${it.activity} has no such fact`); continue }
    if (def.derived) { problem(file, `facts.${k}`, 'derived from the parts, never written'); continue }
    if ((def as { placement?: string }).placement === 'giudizi') { problem(file, `facts.${k}`, 'a rating: the demo never invents one'); continue }
    const why = unreadable(def, v)
    if (why) problem(file, `facts.${k}`, why)
  }
  for (const def of schema.facts) {
    if (!def.optional && !def.derived && facts[def.id] === undefined) problem(file, `facts.${def.id}`, `required on ${it.activity}`)
  }

  // Sections: the prose keys the page draws.
  const prose = storedProse([...schema.document, ...schema.rail])
  for (const [k, v] of Object.entries(it.sections ?? {})) {
    if (!prose.has(k)) problem(file, `sections.${k}`, `${it.activity} draws no such section (it has ${[...prose.keys()].join(', ')})`)
    else if (typeof v !== 'string' || v.trim() === '') problem(file, `sections.${k}`, 'empty')
  }

  // Parts: only where the activity has them, each field readable.
  const parts: any[] = it.parts ?? []
  if (!schema.parts && parts.length > 0) problem(file, 'parts', `${it.activity} has no parts`)
  if (schema.parts) {
    const fields = new Map(schema.parts.fields.map(f => [f.id, f]))
    parts.forEach((p, i) => {
      if (schema.parts!.groupBy === undefined && p.group !== undefined) problem(file, `parts[${i}].group`, `${it.activity}'s parts have no groups`)
      for (const [k, v] of Object.entries(p.fields ?? {})) {
        const def = fields.get(k)
        if (!def) { problem(file, `parts[${i}].${k}`, 'no such field'); continue }
        const why = unreadable(def, v)
        if (why) problem(file, `parts[${i}].${k}`, why)
      }
    })
    if (it.activity === 'falesia' && !parts.some(p => typeof p.fields?.grado === 'string')) problem(file, 'parts', 'a crag needs at least one graded route')
    // What the tags say about the routes holds: no more than their count, none outside their grade range.
    const hints = measuredPlaces.get(doc.osm)?.hints ?? {}
    const tagged = Number(hints['climbing:routes'])
    if (Number.isFinite(tagged) && tagged > 0 && parts.length > tagged) {
      problem(file, 'parts', `${parts.length} routes written, the tags say ${tagged} (fewer is fine)`)
    }
    if (it.activity === 'falesia') {
      const lo = frenchRank(hints['climbing:grade:french:min'] ?? ''), hi = frenchRank(hints['climbing:grade:french:max'] ?? '')
      parts.forEach((p, i) => {
        const r = typeof p.fields?.grado === 'string' ? frenchRank(p.fields.grado) : undefined
        if (r === undefined) return
        if (lo !== undefined && r < lo) problem(file, `parts[${i}].grado`, `${p.fields.grado} is below the tagged minimum ${hints['climbing:grade:french:min']}`)
        if (hi !== undefined && r > hi) problem(file, `parts[${i}].grado`, `${p.fields.grado} is above the tagged maximum ${hints['climbing:grade:french:max']}`)
      })
    }
    if (it.activity === 'multipitch' && parts.length > 0 && facts.tiri !== undefined && facts.tiri !== parts.length) {
      problem(file, 'facts.tiri', `${facts.tiri} pitches, ${parts.length} written`)
    }
  }

  // Reports and their readings.
  const reports: any[] = it.reports ?? []
  const readings: any[] = doc.readings ?? []
  if (readings.length !== reports.length) problem(file, 'readings', `${readings.length} readings for ${reports.length} reports`)
  const tier = tierOf.get(doc.osm)
  if (tier) {
    const [lo, hi] = TIER_REPORTS[tier]
    if (reports.length < lo || reports.length > hi) problem(file, 'reports', `a ${tier} place has ${lo}–${hi} reports, found ${reports.length}`)
    if (tier === 'untouched' && (it.sections?.descrizione || it.sections?.note)) problem(file, 'sections', 'an untouched page has no written description')
  }
  const seen = new Set<string>()
  let weekdays = 0
  reports.forEach((r, i) => {
    if (typeof r.observedAt !== 'string' || !DAY.test(r.observedAt)) problem(file, `reports[${i}].observedAt`, `not a day: ${r.observedAt}`)
    else if (r.observedAt < FIRST_DAY || r.observedAt > LAST_DAY) problem(file, `reports[${i}].observedAt`, `outside ${FIRST_DAY}…${LAST_DAY}: ${r.observedAt}`)
    else if (![0, 6].includes(new Date(`${r.observedAt}T12:00:00Z`).getUTCDay())) weekdays++
    if (typeof r.words !== 'string' || r.words.trim() === '') { problem(file, `reports[${i}].words`, 'empty'); return }
    if (seen.has(r.words)) problem(file, `reports[${i}].words`, 'the same words as an earlier report')
    seen.add(r.words)
    const reading = readings[i] ?? {}
    for (const [j, t] of (reading.themes ?? []).entries()) {
      if (typeof t.label !== 'string' || t.label.trim() === '') problem(file, `readings[${i}].themes[${j}].label`, 'empty')
      if (typeof t.quote !== 'string' || !r.words.includes(t.quote)) problem(file, `readings[${i}].themes[${j}].quote`, `not in the report's words: ${JSON.stringify(t.quote)}`)
    }
    for (const [j, f] of (reading.flags ?? []).entries()) {
      if (f.kind !== 'attenzione' && f.kind !== 'novita') problem(file, `readings[${i}].flags[${j}].kind`, `found ${f.kind}`)
      if (typeof f.label !== 'string' || f.label.trim() === '') problem(file, `readings[${i}].flags[${j}].label`, 'empty')
      if (typeof f.quote !== 'string' || !r.words.includes(f.quote)) problem(file, `readings[${i}].flags[${j}].quote`, `not in the report's words: ${JSON.stringify(f.quote)}`)
    }
  })
  // About a quarter of the days fall on weekdays (Phase 0: 47 of 47 on a weekend read as invented).
  if (reports.length >= 10) {
    const share = weekdays / reports.length
    if (share < 0.15 || share > 0.4) problem(file, 'reports', `${weekdays} of ${reports.length} on weekdays; about a quarter is expected`)
  }
}

if (problems > 0) {
  console.log(`\n${problems} problem(s)`)
  process.exit(1)
}
console.log('no problems')
