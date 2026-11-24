import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIVATE_NAME } from '../../src/import/osm/never-named.ts'
import { freshDb } from '../helpers/db.ts'
import { allItineraries, partsOf } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'
import { synthesisFor } from '../../src/db/synthesis.ts'
import { trackFor } from '../../src/db/track.ts'
import { READING } from '../../src/app/synthesis.ts'
import { buildDemo, demoReportOf, DemoContentError, selectionFromTiers } from '../../src/demo/build.ts'
import { compose, readContent, type ContentFile } from '../../src/demo/content.ts'
import type { DemoPlace } from '../../src/import/osm/translate.ts'
import { osmItineraryId } from '../../src/import/osm/stable-id.ts'

const OSM = fileURLToPath(new URL('../fixtures/osm/', import.meta.url))
const CONTENT = fileURLToPath(new URL('../fixtures/demo/content/', import.meta.url))
const NOW = new Date('2026-11-23T00:00:00Z')

async function build(contentDir = CONTENT, only?: ReadonlySet<string>) {
  const db = await freshDb()
  const result = await buildDemo(db, {
    extractDir: OSM + 'extract', gazetteer: OSM + 'gazetteer/places.json', sharedDir: OSM + 'gazetteer',
    contentDir, now: NOW, ...(only ? { only } : {}),
  })
  return { db, result }
}

/** The fixture content, with one file rewritten or added, in a folder of its own. */
async function contentWith(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'demo-content-test-'))
  await cp(CONTENT, dir, { recursive: true })
  for (const [name, doc] of Object.entries(files)) {
    if (doc === null) await rm(join(dir, name))
    else await writeFile(join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc))
  }
  return dir
}
const fixture = async (name: string) => JSON.parse(await readFile(CONTENT + name, 'utf8'))

async function problemsOf(files: Record<string, unknown>): Promise<string[]> {
  const dir = await contentWith(files)
  try {
    await build(dir)
  } catch (err) {
    if (err instanceof DemoContentError) return [...err.problems]
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  assert.fail('the build should have refused the content')
}

test('a place with content is the measured place with the written content laid over it', async () => {
  const { db, result } = await build()
  assert.deepEqual(result.withContent.map(p => p.osm), ['r30', 'w1'])
  const crag = (await allItineraries(db)).find(i => i.name === 'Corno di Prova')!
  assert.equal(crag.activity, 'falesia')
  assert.equal(crag.aspect, 'SO')
  assert.equal(crag.lat, 45.64385)
  // Measured, written, and the written one that agreed with the measure.
  assert.equal(crag.facts.quota_base, 1189)
  assert.equal(crag.facts.avvicinamento, 15)
  assert.equal(crag.facts.esposizione, 'SO')
  assert.equal(crag.sections.note, 'Placche di gneiss sopra il paese, al sole dal mattino.')
  assert.deepEqual((await partsOf(db, crag.id)).map(p => p.fields.grado), ['5c', '6b+'])
  assert.equal((await giteFor(db, crag.id)).length, 3)
  // A crag's line is its wall; a hike's is the way.
  assert.equal(await trackFor(db, crag.id), null)
  const hike = (await allItineraries(db)).find(i => i.name === 'Anello di Prova')!
  assert.equal(hike.sections.descrizione, 'Un giro tra i castagni sopra il paese.')
  const hikeTrack = await trackFor(db, hike.id)
  assert.equal(hikeTrack?.points.length, 3)
  const [lon, lat] = hikeTrack!.points[0]!
  assert.ok(lon < lat, `a point is [lon, lat], found [${lon}, ${lat}]`)
})

test('the places without content are written by the importer, and not written twice', async () => {
  const { db, result } = await build()
  assert.deepEqual(result.measured.written.map(p => p.osm).sort(), ['n16', 'n20', 'n9', 'r13', 'r31', 'r50', 'r60', 'r61', 'w14', 'w40'])
  const names = (await allItineraries(db)).map(i => i.name)
  assert.equal(names.length, 12)
  assert.equal(new Set(names).size, names.length)
})

test('themes are read by the app from the recorded readings, and a quote not in the words is dropped', async () => {
  const { db, result } = await build()
  const crag = (await allItineraries(db)).find(i => i.name === 'Corno di Prova')!
  const saved = await synthesisFor(db, crag.id)
  assert.equal(saved?.reading, READING)
  assert.equal(saved?.readIds.length, 3)
  assert.deepEqual(saved?.themes.map(t => [t.label, t.count]), [['Avvicinamento breve', 2]])
  assert.deepEqual(saved?.flags.map(f => [f.label, f.kind]), [['Spigolo richiodato', 'novita']])
  // A report with no recorded reading is read as saying nothing.
  const hike = (await allItineraries(db)).find(i => i.name === 'Anello di Prova')!
  assert.deepEqual((await synthesisFor(db, hike.id))?.themes, [])
  assert.deepEqual(result.themes, { itineraries: 2, themes: 1, flags: 1, reports: 4 })
})

test('a place still needing a fact no content supplies is left out and counted, never filled in', async () => {
  const { db, result } = await build()
  // The boulders n11 and n12 are listed under their area (r13), not written one by one. n6 is flat: its content writes vie but no aspect. w1 has its vie.
  assert.deepEqual(result.leftOut.map(p => [p.osm, p.needs, p.file]), [['n6', ['esposizione'], 'n6.json']])
  assert.equal((await allItineraries(db)).some(i => i.name === 'Placca Piatta'), false)
  const report = demoReportOf(result)
  assert.match(report, /^12 places built: 2 with written content, 10 from OpenStreetMap alone; 1 left out\./)
  assert.match(report, /n6, Placca Piatta \(falesia\): n6\.json does not write esposizione/)
  assert.match(report, /Themes read for 2 itineraries from 4 reports: 1 themes, 1 changes\./)
})

test('without its content file a crag is left out for its vie', async () => {
  const dir = await contentWith({ 'w1.json': null })
  try {
    const { result } = await build(dir)
    assert.deepEqual(result.leftOut.find(p => p.osm === 'w1'), { osm: 'w1', name: 'Corno di Prova', activity: 'falesia', needs: ['vie'], file: null })
    assert.match(demoReportOf(result), /1 × falesia, no content file for vie/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a written fact the place still needed is built only when it is said to be invented', async () => {
  const n6 = await fixture('n6.json')
  n6.itinerary.facts = { esposizione: 'E' }
  assert.deepEqual(await problemsOf({ 'n6.json': n6 }), [
    'n6.json: invented: esposizione was not measured and is written here, so it must be listed as invented',
  ])
  n6.invented.push('esposizione')
  const dir = await contentWith({ 'n6.json': n6 })
  try {
    const { db, result } = await build(dir)
    assert.deepEqual(result.leftOut, [])
    const crag = (await allItineraries(db)).find(i => i.name === 'Placca Piatta')!
    assert.equal(crag.aspect, 'E')
    assert.equal(crag.facts.quota_base, 800)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a content file with no matching place is an error naming it', async () => {
  assert.deepEqual(await problemsOf({ 'n999.json': { osm: 'n999', invented: [], itinerary: { key: 'nessuno' } } }), [
    'n999.json: osm: no place n999 in the extract',
  ])
})

test('content for a place the importer refuses is an error naming the refusal', async () => {
  const problems = await problemsOf({ 'n21.json': { osm: 'n21', invented: [], itinerary: { key: 'punta' } } })
  assert.equal(problems.length, 1)
  assert.match(problems[0]!, /^n21\.json: osm: the importer refuses n21 on natural: a summit no marked path reaches/)
})

test('content never decides what or where a place is', async () => {
  const w1 = await fixture('w1.json')
  w1.itinerary.activity = 'multipitch'
  w1.itinerary.name = 'Corno'
  w1.itinerary.place = 'comune-007023'
  w1.itinerary.lat = 45.7
  w1.itinerary.facts.quota_base = 1000
  w1.itinerary.facts.esposizione = 'N'
  assert.deepEqual(await problemsOf({ 'w1.json': w1 }), [
    'w1.json: itinerary.activity: written "multipitch", but OpenStreetMap says "falesia"',
    'w1.json: itinerary.name: written "Corno", but OpenStreetMap says "Corno di Prova"',
    'w1.json: itinerary.place: written "comune-007023", but OpenStreetMap says "comune-007004"',
    'w1.json: itinerary.lat: written 45.7, but OpenStreetMap says 45.64385',
    'w1.json: itinerary.facts.quota_base: written 1000, but terrain says 1189',
    'w1.json: itinerary.facts.esposizione: written "N", but climbing:orientation says "SO"',
  ])
})

test('every problem is named at once, by file, and the build stops', async () => {
  const problems = await problemsOf({
    'r30.json': '{ not json',
    'w1.json': { osm: 'w1', invented: [], itinerary: { key: 'Corno di Prova', reports: [{ observedAt: '2025-01-01', words: 'x' }] }, readings: [] },
    'n6.json': { osm: 'n7', invented: [], itinerary: { key: 'oltre' } },
    'r31.json': { osm: 'r31', invented: [], itinerary: { key: 'muro', sections: { note: `Sotto il Muro ${PRIVATE_NAME}.` } } },
  })
  assert.deepEqual(problems.map(p => p.split(':').slice(0, 2).join(':')), [
    'n6.json: osm', 'r30.json: (file)', 'r31.json: (anywhere)', 'w1.json: itinerary.key', 'w1.json: readings',
  ])
})

test('two content files may not write the same page', async () => {
  const r31 = { osm: 'r31', invented: [], itinerary: { key: 'anello-di-prova' } }
  assert.deepEqual(await problemsOf({ 'r31.json': r31 }), ['r31.json: itinerary.key: anello-di-prova is already r30.json\'s'])
})

test('a selection narrows the places without content; those with content are always in', async () => {
  const { result } = await build(CONTENT, new Set(['r31', 'n6']))
  assert.deepEqual(result.withContent.map(p => p.osm), ['r30', 'w1'])
  assert.deepEqual(result.measured.written.map(p => p.osm), ['r31'])
})

test('the selection says how many it chose and names those the extract does not hold', async () => {
  const { result } = await build(CONTENT, new Set(['r31', 'n404', 'w1']))
  assert.deepEqual(result.selection, { chosen: 3, notInExtract: ['n404'] })
  assert.match(demoReportOf(result), /Selection: 3 places chosen[^\n]*\n  1 chosen places are not in the extract[^:]*: n404/)
  assert.equal((await build()).result.selection, null)
})

test('Phase 3\'s tiers file chooses every tier\'s places, untouched ones included', () => {
  const ids = selectionFromTiers({ tiers: {
    star: [{ osm: 'w1', activity: 'falesia', name: 'Corno di Prova' }],
    untouched: [{ osm: 'r31' }, { osm: 'n6' }],
  } })
  assert.deepEqual([...ids].sort(), ['n6', 'r31', 'w1'])
  assert.throws(() => selectionFromTiers({ counts: {} }), /holds no "tiers"/)
  assert.throws(() => selectionFromTiers({ tiers: { star: [{ name: 'x' }] } }), /star\[0\] has no osm id/)
})

test('no content folder is no content', async () => {
  const { result } = await build(join(tmpdir(), 'no-such-demo-content'))
  assert.deepEqual(result.withContent, [])
  assert.deepEqual(result.leftOut.map(p => p.osm), ['w1', 'n6'])
})

test('compose keeps a measured summit height and repeats nothing it was not given', () => {
  const place: DemoPlace = {
    osm: 'n20', activity: 'escursionismo', name: 'Becca di Prova', nameFrom: 'name', lat: 45.63, lon: 7.74,
    comune: 'Arnad', istat: '007004', measured: { vetta: { value: 2650, from: 'ele' } }, hints: {}, needs: [], track: null,
  }
  const content: ContentFile = { osm: 'n20', invented: [], itinerary: { key: 'becca', altMax: 2600 } }
  assert.deepEqual(compose(place, 'comune-007004', content), {
    kind: 'refused', problems: ['itinerary.altMax: written 2600, but ele says 2650'],
  })
  const built = compose(place, 'comune-007004', { ...content, itinerary: { key: 'becca' } })
  assert.equal(built.kind, 'built')
  if (built.kind === 'built') {
    assert.equal(built.itinerary.altMax, 2650)
    assert.equal('parkingLat' in built.itinerary, false)
    assert.equal('aspect' in built.itinerary, false)
  }
})

test('readContent checks the shape and names the field', () => {
  assert.equal(readContent('{"osm":"w1","invented":[],"itinerary":{"key":"a"}}').ok, true)
  const bad = readContent('{"osm":"x1","itinerary":{"key":"a","reports":[{}]},"readings":[]}')
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.deepEqual(bad.problems.map(p => p.split(':')[0]), ['osm', 'invented', 'readings'])
  }
})

test('the build script refuses an unnamed or private database before opening anything', () => {
  const script = fileURLToPath(new URL('../../scripts/demo/build.ts', import.meta.url))
  for (const env of [{}, { DATABASE_FILE: `${PRIVATE_NAME}.db` }, { DATABASE_FILE: ':memory:' }]) {
    const { DATABASE_FILE: _, ...rest } = process.env
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
      env: { ...rest, ...env }, encoding: 'utf8', cwd: OSM,
    })
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /^Refused: DATABASE_FILE/)
  }
})

test('the build script never replaces a database people use', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-build-guard-'))
  try {
    const file = join(dir, 'used.db')
    const { openDb } = await import('../../src/db/open.ts')
    const { migrate } = await import('../../db/migrate.ts')
    const { insertAccount } = await import('../../src/db/account.ts')
    const db = openDb(file)
    await migrate(db)
    await insertAccount(db, { id: 'a1', email: 'a@example.invalid', passwordHash: 'x', displayName: 'A' })
    await db.close()
    const script = fileURLToPath(new URL('../../scripts/demo/build.ts', import.meta.url))
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
      env: { ...process.env, DATABASE_FILE: file }, encoding: 'utf8',
    })
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /holds accounts or gite/)
    const again = openDb(file)
    const { holdsPeople } = await import('../../src/db/account.ts')
    assert.equal(await holdsPeople(again), true)
    await again.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('every page keeps its address from one build to the next', async () => {
  const first = await build(), second = await build()
  const ids = async (db: typeof first.db) => (await allItineraries(db)).map(i => `${i.name} ${i.id}`).sort()
  assert.deepEqual(await ids(second.db), await ids(first.db))
  // Each id is its place's OpenStreetMap id, through osmItineraryId: with content or measured alone.
  const byName = new Map((await allItineraries(first.db)).map(i => [i.name, i.id]))
  const places = [...first.result.withContent, ...first.result.measured.written]
  assert.ok(first.result.withContent.length > 0 && first.result.measured.written.length > 0)
  for (const p of places) assert.equal(byName.get(p.name), osmItineraryId(p.osm), p.name)
})
