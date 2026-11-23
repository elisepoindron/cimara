import { ACTIVITIES } from '../../src/domain/activities/index.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { seed } from '../../src/seed/seed.ts'
import type { Db } from '../../src/db/open.ts'
import { placeCentre, searchItineraries, searchQuery, vocabularyOf } from '../../src/db/search.ts'
import type { Constraint } from '../../src/domain/find/constraints.ts'
import { gradeScale } from '../../src/domain/quantity.ts'

const alpine = gradeScale('alpine')
const sport = gradeScale('sport')

/**
 * A small archive with the two shapes a place constraint has to cross: an
 * administrative chain (regione, provincia, comune) and a named area that
 * ignores it. The geography is real — Gran Paradiso holds Noasca in Piemonte
 * and Cogne in Valle d'Aosta, which is a region away — and every route name is
 * invented, as everything on a screen in this project is.
 */
async function archive(db: Db): Promise<void> {
  const places: [id: string, name: string, kind: string, parent: string | null][] = [
    ['piemonte',  'Piemonte',      'regione',   null],
    ['cn',        'CN',            'provincia', 'piemonte'],
    ['crissolo',  'Crissolo',      'comune',    'cn'],
    ['to',        'TO',            'provincia', 'piemonte'],
    ['noasca',    'Noasca',        'comune',    'to'],
    ['bussoleno', 'Bussoleno',     'comune',    'to'],
    ['aosta',     'Valle d’Aosta', 'regione',   null],
    ['cogne',     'Cogne',         'comune',    'aosta'],
    ['gp',        'Gran Paradiso', 'area',      null],
    ['vuoto',     'Ceresole Reale','comune',    'to'],
  ]
  for (const [id, name, kind, parent] of places) {
    await db.run('insert into place (id, name, kind, parent_id) values (?, ?, ?, ?)',
      [id, name, kind, parent])
  }

  // Area membership is not the parent chain: Gran Paradiso is nobody's ancestor.
  for (const member of ['noasca', 'cogne']) {
    await db.run('insert into place_area (place_id, area_id) values (?, ?)', [member, 'gp'])
  }

  const routes: [id: string, activity: string, place: string, name: string,
                 lat: number, lon: number, min: number | null, max: number | null][] = [
    ['monviso', 'alpinismo', 'crissolo',  'Monviso, Cresta Est',
     44.6673, 7.0913, alpine.ordinal('AD'), alpine.ordinal('AD')],
    ['vallone', 'alpinismo', 'crissolo',  'Sentiero del Vallone',
     44.6700, 7.0900, null, null],
    ['broglio', 'alpinismo', 'noasca',    'Punta del Broglio, Via Nord',
     45.4500, 7.3500, alpine.ordinal('PD'), alpine.ordinal('PD')],
    ['vallonet','alpinismo', 'cogne',     'Testa di Vallonet, Cresta Ovest',
     45.6100, 7.3500, alpine.ordinal('D'), alpine.ordinal('D')],
    ['balma',   'falesia',   'bussoleno', 'Balma Scura',
     45.0600, 7.1500, sport.ordinal('5a'), sport.ordinal('7b')],
  ]
  for (const [id, activity, place, name, lat, lon, min, max] of routes) {
    await db.run(`
      insert into itinerary (id, activity, place_id, name, lat, lon, created,
                             grade_min, grade_max)
      values (?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?)`,
      [id, activity, place, name, lat, lon, min, max])
  }
}

async function seeded(): Promise<Db> {
  const db = await freshDb()
  await archive(db)
  return db
}

const ids = async (db: Db, cs: readonly Constraint[]) =>
  (await searchItineraries(db, cs)).map(r => r.id).sort()

const activity = (id: string): Constraint =>
  ({ kind: 'activity', id, label: id, inferred: false })
const place = (id: string, name: string): Constraint => ({ kind: 'place', id, name })
const name = (text: string): Constraint => ({ kind: 'name', text })
const grade = (scale: 'alpine' | 'sport', min: number, max: number): Constraint =>
  ({ kind: 'grade', scale, min, max, written: `${min}-${max}` })

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

test('an activity constraint narrows to that activity', async () => {
  const db = await seeded()
  assert.deepEqual(await ids(db, [activity('falesia')]), ['balma'])
  assert.deepEqual(await ids(db, [activity('alpinismo')]),
    ['broglio', 'monviso', 'vallone', 'vallonet'])
})

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

test('a place constraint matches a route whose place it is', async () => {
  const db = await seeded()
  assert.deepEqual(await ids(db, [place('crissolo', 'Crissolo')]), ['monviso', 'vallone'])
})

test('a place constraint reaches every place below it', async () => {
  const db = await seeded()
  // Piemonte holds no route directly. It holds two provinces holding three
  // comuni, and typing a region has to find what is inside it.
  assert.deepEqual(await ids(db, [place('piemonte', 'Piemonte')]),
    ['balma', 'broglio', 'monviso', 'vallone'])
  assert.deepEqual(await ids(db, [place('to', 'TO')]), ['balma', 'broglio'])
})

test('a place constraint reaches an area’s members, which the hierarchy does not', async () => {
  const db = await seeded()
  // Gran Paradiso is the parent of nothing: Noasca's parent is TO and Cogne's is
  // Valle d'Aosta. Only place_area connects them, and the two are a region apart.
  assert.deepEqual(await ids(db, [place('gp', 'Gran Paradiso')]), ['broglio', 'vallonet'])
})

test('a place that holds nothing finds nothing, rather than everything', async () => {
  const db = await seeded()
  assert.deepEqual(await ids(db, [place('vuoto', 'Ceresole Reale')]), [])
})

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

test('a name constraint matches part of a route’s name, whatever the case', async () => {
  const db = await seeded()
  assert.deepEqual(await ids(db, [name('cresta')]), ['monviso', 'vallonet'])
  assert.deepEqual(await ids(db, [name('BALMA')]), ['balma'])
})

test('a name constraint’s words need not be adjacent in the name', async () => {
  const db = await seeded()
  // The parser hands on what it could not read, with the parts it *did* read
  // taken out from between the words. Matching the join as one substring would
  // require the visitor to have typed nothing understood inside a route's name.
  assert.deepEqual(await ids(db, [name('Nord Via')]), ['broglio'])
})

test('a wildcard the visitor typed is a character, not a wildcard', async () => {
  const db = await seeded()
  assert.deepEqual(await ids(db, [name('%')]), [])
  assert.deepEqual(await ids(db, [name('_')]), [])
  assert.deepEqual(await ids(db, [name('Bal_a')]), [], 'an underscore matches an underscore')
})

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

test('a grade constraint narrows on the ordinal columns', async () => {
  const db = await seeded()
  // "fino a PD": PD is in, AD and D are above it.
  assert.deepEqual(await ids(db, [grade('alpine', 0, alpine.ordinal('PD'))]), ['broglio'])
  assert.deepEqual(
    await ids(db, [grade('alpine', alpine.ordinal('AD'), alpine.ordinal('D'))]),
    ['monviso', 'vallonet'])
})

test('a grade constraint never reaches a row on another scale', async () => {
  const db = await seeded()
  // 6a is 7 and 7b is 15 on the sport scale; AD is 6 and D is 9 on the alpine
  // one. A query for sport 7..15 that forgot the scale would hand back the
  // alpine D route, whose "9" means nothing of the kind.
  assert.ok(sport.ordinal('7b') > alpine.ordinal('D'),
    'the ranges overlap as integers, which is the whole hazard')
  assert.deepEqual(
    await ids(db, [grade('sport', sport.ordinal('6a'), sport.ordinal('7b'))]), ['balma'])
})

test('a grade contradicting the activity it arrives with finds nothing', async () => {
  const db = await seeded()
  // "alpinismo dal 6a al 7b" parses to exactly this pair. The answer is an empty
  // list the read-back sentence explains, never an alpine row compared against a
  // sport ordinal.
  assert.deepEqual(
    await ids(db, [activity('alpinismo'),
                   grade('sport', sport.ordinal('6a'), sport.ordinal('7b'))]), [])
})

test('a grade with no activity beside it still cannot cross scales', async () => {
  const db = await seeded()
  // The parser infers no activity when a line's grades disagree about the scale,
  // so the grade fragment has to carry the scale itself rather than trust that
  // an activity constraint arrived to do it.
  const cs = [grade('alpine', 0, alpine.ordinal('D')),
              grade('sport', 0, sport.ordinal('9a'))]
  assert.deepEqual(await ids(db, cs), [], 'two scales at once are two activities at once')
  assert.deepEqual(await ids(db, [cs[1]!]), ['balma'])
})

test('a route that declares no grade is not what a grade constraint asked for', async () => {
  const db = await seeded()
  const all = await ids(db, [activity('alpinismo')])
  assert.ok(all.includes('vallone'), 'the ungraded route is in the archive')
  assert.deepEqual(await ids(db, [grade('alpine', 0, alpine.ordinal('EX'))]),
    ['broglio', 'monviso', 'vallonet'], 'but the whole scale does not reach it')
})

test('a route whose range straddles the asked one survives it', async () => {
  const db = await seeded()
  // Balma Scura runs 5a to 7b. A visitor asking for 5a wants it; a crag is not
  // disqualified by holding pitches harder than the question.
  assert.deepEqual(await ids(db, [grade('sport', sport.ordinal('5a'), sport.ordinal('5a'))]),
    ['balma'])
  assert.deepEqual(await ids(db, [grade('sport', 0, sport.ordinal('4c'))]), [],
    'and a range entirely below it reaches nothing')
})

// ---------------------------------------------------------------------------
// Together, and empty
// ---------------------------------------------------------------------------

test('constraints narrow together', async () => {
  const db = await seeded()
  const cs = [activity('alpinismo'), place('piemonte', 'Piemonte'),
              grade('alpine', 0, alpine.ordinal('AD')), name('Cresta')]
  assert.deepEqual(await ids(db, cs), ['monviso'])
})

test('no constraints is the whole archive', async () => {
  const db = await seeded()
  const rows = await searchItineraries(db, [])
  assert.deepEqual(rows.map(r => r.id).sort(),
    ['balma', 'broglio', 'monviso', 'vallone', 'vallonet'])
})

test('a candidate carries what a ranked row is built from', async () => {
  const db = await seeded()
  const [row] = await searchItineraries(db, [name('Monviso')])
  assert.equal(row!.id, 'monviso')
  assert.equal(row!.activity, 'alpinismo')
  assert.equal(row!.placeName, 'Crissolo', 'the row reads "CN Crissolo", not a place id')
  assert.equal(row!.gradeMax, alpine.ordinal('AD'))
  assert.equal(row!.lat, 44.6673)
})

test('a candidate says which scale its ordinals are on', async () => {
  const db = await seeded()
  const scales = new Map((await searchItineraries(db, []))
    .map(r => [r.id, r.gradeScale] as const))

  assert.equal(scales.get('monviso'), 'alpine')
  assert.equal(scales.get('balma'), 'sport')
  assert.equal(scales.get('vallone'), 'alpine',
    'an ungraded route still knows the scale it would have counted on')
})

// ---------------------------------------------------------------------------
// Near
// ---------------------------------------------------------------------------

test('a near constraint narrows to the box around the place', async () => {
  const db = await seeded()
  const near: Constraint = { kind: 'near', placeId: 'crissolo', placeName: 'Crissolo', withinKm: 15 }
  assert.deepEqual(await ids(db, [near]), ['monviso', 'vallone'])
})

test('a near constraint reaches a place through everything below it', async () => {
  const db = await seeded()
  // Gran Paradiso holds Noasca and Cogne, seventeen kilometres apart; its
  // position is where the routes under it are, because no place in this archive
  // carries coordinates of its own.
  const near: Constraint = { kind: 'near', placeId: 'gp', placeName: 'Gran Paradiso', withinKm: 30 }
  assert.deepEqual(await ids(db, [near]), ['broglio', 'vallonet'])
})

test('a place the archive holds nothing under has no position, and narrows nothing', async () => {
  const db = await seeded()
  const near: Constraint = { kind: 'near', placeId: 'vuoto', placeName: 'Ceresole Reale', withinKm: 5 }
  assert.deepEqual(await ids(db, [near]),
    ['balma', 'broglio', 'monviso', 'vallone', 'vallonet'],
    'nothing to measure from is not the same as nothing within range')
})

// ---------------------------------------------------------------------------
// The plan, against a table big enough for it to matter
// ---------------------------------------------------------------------------

async function manyRoutes(db: Db): Promise<void> {
  await db.run(`insert into place (id, name, kind) values ('big', 'Grande', 'regione')`)
  await db.tx(async () => {
    for (let i = 0; i < 4000; i++) {
      await db.run(`
        insert into itinerary (id, activity, place_id, name, lat, lon, created,
                               grade_min, grade_max)
        values (?, 'alpinismo', 'big', ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?)`,
        [`b${i}`, `Via ${i}`, 44 + i / 100000, 7 + i / 100000, i % 18, i % 18])
    }
  })
}

const planOf = async (db: Db, q: { sql: string; params: readonly (string | number | null)[] }) =>
  (await db.all<{ detail: string }>(`explain query plan ${q.sql}`, q.params))
    .map(p => p.detail).join(' ')

test('a grade constraint is answered through itinerary_grade_idx, not by walking the table', async () => {
  const db = await seeded()
  await manyRoutes(db)

  const detail = await planOf(db, searchQuery(
    [activity('alpinismo'), grade('alpine', 0, alpine.ordinal('AD'))], []))

  assert.match(detail, /itinerary_grade_idx/,
    'the index migration 007 created is the one that answers this')
  assert.doesNotMatch(detail, /SCAN itinerary/,
    'four thousand rows are not read to answer a question about six of them')
})

test('a near constraint is answered through itinerary_bbox_idx, not by walking the table', async () => {
  const db = await seeded()
  await manyRoutes(db)

  const detail = await planOf(db, searchQuery([], [
    { minLat: 44.6, maxLat: 44.7, minLon: 7.0, maxLon: 7.2 },
  ]))

  assert.match(detail, /itinerary_bbox_idx/, 'the same prefilter the neighbour query uses')
  assert.doesNotMatch(detail, /SCAN itinerary/)
})

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

test('the vocabulary is every place the archive holds', async () => {
  const db = await seeded()
  const vocabulary = await vocabularyOf(db)

  const names = vocabulary.places.map(p => p.name)
  assert.ok(names.includes('Gran Paradiso'), 'an area is a name a visitor may type')
  assert.ok(names.includes('Crissolo'))
  assert.equal(vocabulary.places.length, 10)
  assert.equal(vocabulary.places.find(p => p.name === 'Crissolo')?.id, 'crissolo')
})

test('the vocabulary’s activities come from the registry, not from a list', async () => {
  const db = await seeded()
  const vocabulary = await vocabularyOf(db)

  assert.deepEqual(vocabulary.activities.map(a => a.id).sort(), Object.keys(ACTIVITIES).sort())
  assert.equal(vocabulary.activities.find(a => a.id === 'alpinismo')?.label, 'Alpinismo',
    'the label is the Italian one a climber reads')
})

test('an activity with nothing in the archive is still a word that can be typed', async () => {
  const db = await freshDb()
  const vocabulary = await vocabularyOf(db)
  assert.equal(vocabulary.activities.length, 19, 'the registry says what exists, not the table')
  assert.deepEqual(vocabulary.places, [])
})

test('a place with no routes under it still has a centre, if it carries one', async () => {
  const db = await freshDb()
  await seed(db)

  const torino = (await db.get<{ id: string }>(
    `select id from place where name = 'Torino'`))!
  const centre = await placeCentre(db, torino.id)

  assert.ok(centre, 'a city you drive from holds no routes to average')
  assert.ok(Math.abs(centre.lat - 45.07) < 0.05)
  assert.ok(Math.abs(centre.lon - 7.69) < 0.05)
})

test('a place that carries no position of its own falls back to its routes', async () => {
  const db = await freshDb()
  await seed(db)

  const crissolo = (await db.get<{ id: string }>(
    `select id from place where name = 'Crissolo'`))!
  const centre = await placeCentre(db, crissolo.id)

  assert.ok(centre, 'the routes under it are a better description than a chosen point')
  assert.ok(centre.lat > 44 && centre.lat < 45.5)
})

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const fact = (id: string, match: 'is' | 'includes' | 'atMost' | 'atLeast', value: string | boolean | number): Constraint =>
  ({ kind: 'fact', activities: ['falesia'], id, match, value, written: id })

test('a fact constraint matches the crags that hold it, and not those that do not say', async () => {
  const db = await seeded()
  await db.run(`insert into itinerary (id, activity, place_id, name, lat, lon, created)
    values ('croce', 'falesia', 'bussoleno', 'Falesia della Croce', 45.04, 7.14, '2026-09-01T00:00:00.000Z')`)
  await db.run(`insert into itinerary (id, activity, place_id, name, lat, lon, created)
    values ('merlo', 'falesia', 'bussoleno', 'Roccia del Merlo', 45.07, 7.16, '2026-09-01T00:00:00.000Z')`)
  await db.run('update itinerary set facts = ? where id = ?',
    [JSON.stringify({ con_la_pioggia: true, stagione: ['autunno', 'inverno'] }), 'balma'])
  await db.run('update itinerary set facts = ? where id = ?',
    [JSON.stringify({ con_la_pioggia: false, stagione: ['estate'] }), 'merlo'])

  assert.deepEqual(await ids(db, [fact('con_la_pioggia', 'is', true)]), ['balma'])
  assert.deepEqual(await ids(db, [fact('stagione', 'includes', 'inverno')]), ['balma'])
  assert.deepEqual(await ids(db, [fact('stagione', 'includes', 'estate')]), ['merlo'])
  assert.deepEqual(await ids(db, [fact('stagione', 'includes', 'primavera')]), [],
    'croce records no season and is not returned')
})

test('a threshold compares the stored number, and a counted fact counts the parts', async () => {
  const db = await seeded()
  await db.run(`insert into itinerary (id, activity, place_id, name, lat, lon, created)
    values ('merlo', 'falesia', 'bussoleno', 'Roccia del Merlo', 45.07, 7.16, '2026-09-01T00:00:00.000Z')`)
  await db.run('update itinerary set facts = ? where id = ?', [JSON.stringify({ avvicinamento: 20 }), 'balma'])
  await db.run('update itinerary set facts = ? where id = ?', [JSON.stringify({ avvicinamento: 5 }), 'merlo'])
  for (let n = 1; n <= 12; n++) {
    await db.run(`insert into part (id, itinerary_id, position, fields) values (?, 'balma', ?, '{}')`, [`p${n}`, n])
  }

  assert.deepEqual(await ids(db, [fact('avvicinamento', 'atMost', 10)]), ['merlo'])
  assert.deepEqual((await ids(db, [fact('avvicinamento', 'atMost', 20)])).sort(), ['balma', 'merlo'])
  assert.deepEqual(await ids(db, [fact('vie', 'atLeast', 10)]), ['balma'], 'twelve parts, never stored as a fact')
  assert.deepEqual(await ids(db, [fact('vie', 'atLeast', 20)]), [])
})

test('a shared phrase is answered by a route of any activity that declares it', async () => {
  const db = await seeded()
  await db.run('update itinerary set facts = ? where id = ?', [JSON.stringify({ esposizione: 'S' }), 'balma'])
  const shared: Constraint = { kind: 'fact', activities: ['alpinismo', 'falesia'], id: 'esposizione',
    match: 'is', value: 'S', written: 'esposte a sud' }
  assert.ok((await ids(db, [shared])).includes('balma'))
})
