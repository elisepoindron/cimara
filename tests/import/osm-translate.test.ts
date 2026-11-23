import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMetres, translateOsm, type OsmTranslated, type OsmVocabulary } from '../../src/import/osm/translate.ts'
import type { OsmRow } from '../../src/import/osm/source.ts'

const known: OsmVocabulary = {
  comuneByIstat: { '007004': 'p-arnad', '007023': 'p-donnas' },
  comuneByName: { Arnad: 'p-arnad', Donnas: 'p-donnas', Samone: null },
  provinces: new Set(['001', '007']),
  created: '2026-11-19T00:00:00.000Z',
}

const row = (over: Partial<OsmRow>): OsmRow => ({
  osm: 'n1', source: 'climbing', tags: { name: 'Corno di Prova', sport: 'climbing' },
  point: { lat: 45.6, lon: 7.7 }, track: null, comune: { name: 'Arnad', istat: '007004' },
  terrain: { ele: 1189, slope: 49, facing: 225 }, onMarkedPath: false, area: null, ...over,
})

function refusal(t: OsmTranslated): { field: string; reason: string; found: string } {
  assert.equal(t.ok, false, 'expected a refusal')
  if (t.ok) throw new Error('unreachable')
  assert.equal(t.refusals.length, 1, 'one reason, not several')
  return t.refusals[0]!
}
function taken(t: OsmTranslated) {
  if (!t.ok) assert.fail(`refused: ${t.refusals.map(r => `${r.field}: ${r.reason}`).join('; ')}`)
  return t
}

test('a crag is taken with its measured height and aspect, and waits for its vie', () => {
  const t = taken(translateOsm(row({}), known))
  assert.equal(t.place.activity, 'falesia')
  assert.deepEqual(t.place.measured.quota_base, { value: 1189, from: 'terrain' })
  assert.equal(t.place.measured.esposizione?.value, 'SO')
  assert.deepEqual(t.place.needs, ['vie'])
  assert.equal(t.itinerary, null, 'never written without a graded via')
})

test('the mapped orientation wins over the terrain', () => {
  const t = taken(translateOsm(row({ tags: { name: 'X', sport: 'climbing', 'climbing:orientation': 'nw' } }), known))
  assert.deepEqual(t.place.measured.esposizione, { value: 'NO', from: 'climbing:orientation' })
})

test('on flat ground the aspect is unknown, not guessed', () => {
  const t = taken(translateOsm(row({ terrain: { ele: 800, slope: 14, facing: 90 } }), known))
  assert.equal(t.place.measured.esposizione, undefined)
  assert.deepEqual(t.place.needs, ['esposizione', 'vie'])
})

test('a crag with no measured height is refused, not given one', () => {
  assert.equal(refusal(translateOsm(row({ terrain: null }), known)).field, 'quota_base')
})

test('a crag whose vie were written is a complete row, held to the registry', () => {
  const written = { parts: [{ group: 'Settore A', fields: { nome: 'Spigolo', grado: '6a' } }] }
  const t = taken(translateOsm(row({}), known, written))
  assert.deepEqual(t.place.needs, [])
  assert.equal(t.itinerary?.activity, 'falesia')
  assert.equal(t.itinerary?.placeId, 'p-arnad')
  assert.equal(t.itinerary?.aspect, 'SO')
  assert.deepEqual(t.itinerary?.facts, { quota_base: 1189, esposizione: 'SO' })
  assert.equal(t.parts.length, 1)

  const bad = { parts: [{ fields: { nome: 'Spigolo', grado: '6z' } }] }
  assert.equal(refusal(translateOsm(row({}), known, bad)).field, 'facts')
})

test('gyms, ice and single routes are refused on what they are, once', () => {
  const gym = refusal(translateOsm(row({ tags: { sport: 'climbing', leisure: 'sports_centre' } }), known))
  assert.equal(gym.field, 'leisure')
  assert.equal(refusal(translateOsm(row({ tags: { name: 'P', sport: 'climbing', indoor: 'yes' } }), known)).field, 'indoor')
  assert.equal(refusal(translateOsm(row({ tags: { name: 'C', 'climbing:ice': 'yes' } }), known)).field, 'climbing:ice')
  const route = refusal(translateOsm(row({ tags: { name: 'V', climbing: 'route_bottom' } }), known))
  assert.equal(route.field, 'climbing')
  assert.equal(route.found, 'route_bottom')
})

test('no name, no place, no comune in the archive: each refused by its field', () => {
  assert.equal(refusal(translateOsm(row({ tags: { sport: 'climbing' } }), known)).field, 'name')
  assert.equal(refusal(translateOsm(row({ point: null }), known)).field, 'geometry')
  assert.equal(refusal(translateOsm(row({ comune: null }), known)).field, 'comune')
  assert.equal(refusal(translateOsm(row({ comune: undefined }), known)).field, 'comune')
  const missing = refusal(translateOsm(row({ comune: { name: 'Courmayeur', istat: '007022' } }), known))
  assert.match(missing.reason, /the comuni list is not seeded/)
  assert.equal(missing.found, 'Courmayeur (ISTAT 007022)')
  const away = refusal(translateOsm(row({ comune: { name: 'Genova', istat: '010025' } }), known))
  assert.match(away.reason, /outside Piemonte/)
  const twice = refusal(translateOsm(row({ comune: { name: 'Samone', istat: null } }), known))
  assert.match(twice.reason, /share this name/)
})

test('the ISTAT code finds the comune before the name does', () => {
  const t = taken(translateOsm(row({ comune: { name: 'Arnad (fr)', istat: '007004' } }), known))
  assert.equal(t.place.comune, 'Arnad (fr)')
  const byName = taken(translateOsm(row({ comune: { name: 'Donnas', istat: null } }), known))
  assert.equal(byName.place.istat, null)
})

test('a summit is a walk only where a marked path reaches it, and never alpinismo', () => {
  const peak = (over: Partial<OsmRow>) => row({ source: 'peaks', tags: { name: 'Becca', natural: 'peak', ele: '2650' }, terrain: null, ...over })
  const t = taken(translateOsm(peak({ onMarkedPath: true }), known))
  assert.equal(t.place.activity, 'escursionismo')
  assert.deepEqual(t.itinerary?.facts, { vetta: 2650 })
  assert.equal(t.itinerary?.altMax, 2650)
  assert.equal(refusal(translateOsm(peak({ onMarkedPath: false }), known)).field, 'natural')
  assert.equal(refusal(translateOsm(peak({ onMarkedPath: true, tags: { name: 'B', natural: 'peak' } }), known)).field, 'ele')
  assert.equal(refusal(translateOsm(peak({ onMarkedPath: true, tags: { name: 'B', natural: 'peak', ele: '2.650,5' } }), known)).field, 'ele')
})

test('heights are read as written or not at all', () => {
  assert.equal(readMetres('2650'), 2650)
  assert.equal(readMetres('2650 m'), 2650)
  assert.equal(readMetres('2650.4'), 2650)
  assert.equal(readMetres('ca. 2650'), null)
  assert.equal(readMetres(undefined), null)
})

test('a hiking route takes its ref where it has no name, and no start height it cannot be sure of', () => {
  const hike = (tags: Record<string, string>) => row({
    source: 'hiking', osm: 'r30', tags, terrain: { ele: 400 }, track: [[45.6, 7.76], [45.61, 7.77]],
  })
  const named = taken(translateOsm(hike({ name: 'Anello', route: 'hiking', cai_scale: 'EE' }), known))
  assert.deepEqual(named.itinerary?.facts, { difficolta: 'EE' })
  assert.equal(named.place.hints.quota_primo_punto, '400', 'the first point may be either end')
  const fromRef = taken(translateOsm(hike({ ref: '7A', route: 'hiking' }), known))
  assert.equal(fromRef.place.name, 'Sentiero 7A')
  assert.equal(fromRef.place.nameFrom, 'ref')
  assert.equal(refusal(translateOsm(hike({ route: 'hiking' }), known)).field, 'name')
})

test('via ferrata and ski touring need nothing more than a name and a comune', () => {
  const vf = taken(translateOsm(row({ source: 'via_ferrata', tags: { name: 'Ferrata', highway: 'via_ferrata', via_ferrata_scale: '3' } }), known))
  assert.equal(vf.itinerary?.activity, 'via_ferrata')
  assert.deepEqual(vf.itinerary?.facts, {})
  assert.equal(vf.place.hints.via_ferrata_scale, '3')
  const ski = taken(translateOsm(row({ source: 'skitour', tags: { name: 'Gita', 'piste:type': 'skitour' }, terrain: { ele: 1500 } }), known))
  assert.equal(ski.itinerary?.activity, 'sci_alpinismo')
  assert.deepEqual(ski.itinerary?.facts, {})
})

test('prominence is kept as a hint for the selection, never as a fact', () => {
  const t = taken(translateOsm(row({ tags: { name: 'C', sport: 'climbing', wikidata: 'Q1', wikipedia: 'it:C' } }), known))
  assert.deepEqual(t.place.hints, { wikidata: 'Q1', wikipedia: 'it:C' })
})

test('nothing taken or refused carries the name the demo never names', () => {
  const word = ['Gul', 'liver'].join('')
  const r = refusal(translateOsm(row({ tags: { name: `Muro ${word}`, sport: 'climbing' } }), known))
  assert.equal(r.field, 'name')
  assert.equal(r.found, '(withheld)')
  const t = taken(translateOsm(row({ tags: { name: 'C', sport: 'climbing', description: `vedi ${word.toLowerCase()}.it` } }), known))
  assert.equal(t.place.hints.description, undefined)
  assert.doesNotMatch(JSON.stringify(t), new RegExp(word, 'i'))
})

test('the same row twice is the same answer', () => {
  assert.deepEqual(translateOsm(row({}), known), translateOsm(row({}), known))
})

// ---------------------------------------------------------------------------
// Multi-pitch, bouldering, mountain bike: each from its own tags
// ---------------------------------------------------------------------------

const route = (tags: Record<string, string>, over: Partial<OsmRow> = {}) =>
  row({ tags: { name: 'Via Lunga', sport: 'climbing', climbing: 'route_bottom', ...tags }, ...over })

test('a route its tags call multi-pitch is one, with what the tags record as facts', () => {
  const t = taken(translateOsm(route({
    'climbing:multipitch': 'yes', 'climbing:pitches': '6', 'climbing:length': '200',
    'climbing:grade:french': '6a+', 'climbing:bolted': 'yes', 'climbing:orientation': 'S',
  }), known))
  assert.equal(t.place.activity, 'multipitch')
  assert.deepEqual(t.place.needs, [])
  assert.deepEqual(t.itinerary?.facts, {
    quota_base: 1189, esposizione: 'S', grado_max: '6a+', sviluppo: 200, tiri: 6, protezione: 'spittata',
  })
  assert.equal(t.place.measured.grado_max?.from, 'climbing:grade:french')
  assert.equal('grado_obbligatorio' in (t.itinerary?.facts ?? {}), false, 'no tag records it, so it is not filled')
})

test('pitches above one, or a length beyond one rope, is enough to call it multi-pitch', () => {
  assert.equal(taken(translateOsm(route({ 'climbing:pitches': '3' }), known)).place.activity, 'multipitch')
  const long = taken(translateOsm(route({ 'climbing:length': '120' }), known))
  assert.equal(long.place.activity, 'multipitch')
  assert.equal(long.itinerary?.facts.tiri, undefined, 'how many pitches is not counted from the length')
})

test('a single-pitch route stays refused, and a route that contradicts itself is refused on the field', () => {
  assert.equal(refusal(translateOsm(route({ 'climbing:length': '30' }), known)).field, 'climbing')
  assert.equal(refusal(translateOsm(route({ 'climbing:pitches': '1' }), known)).field, 'climbing')
  const odd = refusal(translateOsm(route({ 'climbing:multipitch': 'yes', 'climbing:pitches': '1' }), known))
  assert.equal(odd.field, 'climbing:pitches')
  assert.equal(odd.found, '1')
})

test('a multi-pitch takes only what is on the scale and says which way it faces only once', () => {
  const t = taken(translateOsm(route({
    'climbing:multipitch': 'yes', 'climbing:grade:french': '6a/6a+', 'climbing:orientation': 'N;E',
    'climbing:trad': 'yes',
  }, { terrain: { ele: 900, slope: 8, facing: 0 } }), known))
  assert.equal(t.itinerary?.facts.grado_max, undefined)
  assert.equal(t.place.hints['climbing:grade:french'], '6a/6a+', 'kept for the writers')
  assert.equal(t.itinerary?.facts.esposizione, undefined, 'two directions and flat ground: unknown')
  assert.equal(t.itinerary?.facts.protezione, 'trad')
  const both = taken(translateOsm(route({ 'climbing:pitches': '4', 'climbing:bolted': 'yes', 'climbing:trad': 'yes' }), known))
  assert.equal(both.itinerary?.facts.protezione, 'da_integrare')
  const max = taken(translateOsm(route({ 'climbing:pitches': '4', 'climbing:grade:french': '6a', 'climbing:grade:french:max': '6c' }), known))
  assert.deepEqual(max.place.measured.grado_max, { value: '6c', from: 'climbing:grade:french:max' })
})

test('a boulder area is one by its tags, and a crag with boulders stays a crag', () => {
  const b = taken(translateOsm(row({ tags: { name: 'Blocchi', sport: 'climbing', climbing: 'area', 'climbing:boulder': 'yes' } }), known))
  assert.equal(b.place.activity, 'bouldering')
  assert.deepEqual(b.itinerary?.facts, {})
  const place = taken(translateOsm(row({ tags: { name: 'Sasso', sport: 'climbing', 'climbing:boulder': 'yes' } }), known))
  assert.equal(place.place.activity, 'bouldering')
  const mixed = taken(translateOsm(row({ tags: { name: 'C', sport: 'climbing', 'climbing:boulder': 'yes', 'climbing:sport': 'yes' } }), known))
  assert.equal(mixed.place.activity, 'falesia')
  const crag = taken(translateOsm(row({ tags: { name: 'C', sport: 'climbing', climbing: 'crag', 'climbing:boulder': 'yes' } }), known))
  assert.equal(crag.place.activity, 'falesia')
  assert.equal(refusal(translateOsm(row({ tags: { name: 'B', sport: 'climbing', climbing: 'boulder', leisure: 'sports_centre' } }), known)).field, 'leisure')
})

test('the name never decides the activity', () => {
  const t = taken(translateOsm(row({ tags: { name: 'Via Lunga dei Blocchi', sport: 'climbing', climbing: 'crag' } }), known))
  assert.equal(t.place.activity, 'falesia')
})

test('a mountain-bike route is taken like a hiking route, its ref naming it where it has no name', () => {
  const ride = (tags: Record<string, string>) => row({
    source: 'mtb', osm: 'r60', tags, terrain: null, track: [[45.59, 7.75], [45.6, 7.76]],
  })
  const named = taken(translateOsm(ride({ name: 'Giro', route: 'mtb', 'mtb:scale': '2' }), known))
  assert.equal(named.itinerary?.activity, 'mountain_bike')
  assert.deepEqual(named.itinerary?.facts, {})
  assert.equal(named.place.hints['mtb:scale'], '2')
  assert.equal(taken(translateOsm(ride({ ref: '12', route: 'mtb' }), known)).place.name, 'Percorso MTB 12')
  assert.equal(refusal(translateOsm(ride({ route: 'mtb' }), known)).field, 'name')
})

test('a boulder in an area is listed under it, with its name and grades, and is not a place', () => {
  const t = translateOsm(row({ area: 'r13', tags: {
    name: 'Soffio', natural: 'rock', sport: 'climbing', 'climbing:boulder': 'yes',
    'climbing:grade:font:max': '7a', 'climbing:routes': '3', wikidata: 'Q5',
  } }), known)
  assert.equal(t.ok, false)
  assert.ok(!t.ok && 'memberOf' in t)
  if (t.ok || !('memberOf' in t)) return
  assert.equal(t.memberOf, 'r13')
  assert.deepEqual(t.member, { osm: 'n1', name: 'Soffio', tags: { 'climbing:grade:font:max': '7a', 'climbing:routes': '3' } })
  assert.equal(t.refusals.length, 0)
})

test('a boulder with no area is refused, unless it is known on its own', () => {
  const lone = refusal(translateOsm(row({ tags: { name: 'Sasso', climbing: 'boulder', sport: 'climbing' } }), known))
  assert.equal(lone.field, 'climbing')
  assert.match(lone.reason, /single boulder with no area/)
  const rock = refusal(translateOsm(row({ tags: { name: 'S', natural: 'stone', 'climbing:boulder': 'yes', sport: 'climbing' } }), known))
  assert.equal(rock.found, 'climbing:boulder=yes, natural=stone')
  const known1 = taken(translateOsm(row({ tags: { name: 'Pietra Alta', climbing: 'boulder', natural: 'stone', sport: 'climbing', wikidata: 'Q105968531' } }), known))
  assert.equal(known1.place.activity, 'bouldering')
})

test('an area of boulders is a place, whether tagged one or drawn as no rock', () => {
  assert.equal(taken(translateOsm(row({ tags: { name: 'Area', climbing: 'area', 'climbing:boulder': 'yes', sport: 'climbing' } }), known)).place.activity, 'bouldering')
  assert.equal(taken(translateOsm(row({ tags: { name: 'Rocca Boulder Area', 'climbing:boulder': 'yes', sport: 'climbing' } }), known)).place.activity, 'bouldering')
})
