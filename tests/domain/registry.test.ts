import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defineActivity, fact, generated, parts, rowFact, histogram, distance,
} from '../../src/domain/registry.ts'
import { activityOf, ACTIVITIES, ACTIVITY_FAMILIES, UnknownActivity } from '../../src/domain/activities/index.ts'
import { gradeScale, text } from '../../src/domain/quantity.ts'

test('alpinismo declares its header facts in the order the page shows them', () => {
  const it = activityOf('alpinismo')
  assert.deepEqual(it.facts.map(f => f.id),
    ['difficolta', 'dislivello', 'partenza', 'vetta', 'esposizione', 'giorni', 'tiri', 'protezione'])
  assert.deepEqual(it.facts.map(f => f.label.it),
    ['Difficoltà', 'Dislivello', 'Partenza', 'Vetta', 'Esposizione', 'Giorni', 'Tiri', 'Protezione'])
  assert.equal(it.facts.every(f => f.derived === undefined), true, 'alpine facts are authored')
})

test('alpinismo and falesia both declare the same four access facts', () => {
  const ids = ['localita_partenza', 'come_arrivare', 'da_torino', 'parcheggio_nota']
  assert.deepEqual(activityOf('alpinismo').access?.map(f => f.id), ids)
  assert.deepEqual(activityOf('falesia').access?.map(f => f.id), ids)
  assert.equal(activityOf('alpinismo').access?.every(f => f.optional), true)
})

test('every activity with access facts draws the road in its rail, in one panel called Come arrivare', () => {
  // The road left the document column: it sits under the parking map, the
  // photos above it.
  const panel = (a: string) => activityOf(a).rail.find(s => s.id === 'parcheggio')
  assert.equal(panel('falesia')?.render, 'punti')
  assert.equal(panel('multipitch')?.render, 'punti')
  assert.equal(panel('multipitch')?.point?.it, 'Attacco', 'a multi-pitch names where the climbing starts')
  assert.equal(panel('alpinismo')?.render, 'parcheggio')
  // A hike, a ski tour, a ferrata and a ride draw their track where they have
  // one; a boulder area its parking and its blocks, as a crag.
  for (const a of ['escursionismo', 'sci_alpinismo', 'via_ferrata', 'mountain_bike']) {
    assert.equal(panel(a)?.render, 'traccia', a)
  }
  assert.equal(panel('bouldering')?.render, 'punti')
  assert.equal(panel('bouldering')?.point?.it, 'Blocchi')
  for (const a of ['falesia', 'alpinismo', 'escursionismo', 'sci_alpinismo', 'multipitch',
                   'via_ferrata', 'mountain_bike', 'bouldering']) {
    assert.equal(panel(a)?.label.it, 'Come arrivare', a)
    assert.equal(activityOf(a).document.some(s => s.id === 'accesso'), false, a)
    const rail = activityOf(a).rail.map(s => s.id)
    assert.ok(rail.indexOf('foto') < rail.indexOf('parcheggio'), `${a}: the photos come first`)
  }
})

test('alpinismo declares its document column in the order route.html renders it', () => {
  const doc = activityOf('alpinismo').document
  assert.deepEqual(doc.map(s => s.id),
    ['descrizione', 'profilo', 'relazioni', 'avvicinamento', 'storico', 'altri'])
  // The descent, the gear and the notes are run-ins of the description, as on a multi-pitch.
  assert.deepEqual(doc.find(s => s.id === 'descrizione')?.runIns?.map(r => r.id), ['discesa', 'materiale', 'note'])
})

test('the tail group matches route.html and crag.html exactly — through avvicinamento, not storico or altri', () => {
  // Both mockups wrap only avvicinamento in <div class="tail"> (the route's note
  // and materiale now run on inside its description); storico and altri render as separate top-level sections
  // after it. Confirmed by the `.doc>section#storico` rule in public/app.css —
  // a direct-child selector that would never match a #storico nested inside .tail.
  const group = (a: string, id: string) => activityOf(a).document.find(s => s.id === id)?.group

  assert.equal(group('alpinismo', 'avvicinamento'), 'tail')
  assert.equal(group('alpinismo', 'descrizione'), undefined)
  assert.equal(group('alpinismo', 'relazioni'), undefined)
  assert.equal(group('alpinismo', 'storico'), undefined)
  assert.equal(group('alpinismo', 'altri'), undefined)

  // A crag's note is its description, before the reports, not tail prose.
  assert.equal(group('falesia', 'descrizione'), undefined)
  assert.equal(group('falesia', 'avvicinamento'), 'tail')
  assert.equal(group('falesia', 'gradi'), undefined)
  assert.equal(group('falesia', 'settori'), undefined)
  assert.equal(group('falesia', 'relazioni'), undefined)
  assert.equal(group('falesia', 'storico'), undefined)
  assert.equal(group('falesia', 'altri'), undefined)
})

test('a hike opens on its Descrizione, the note inside it, as every activity does', () => {
  const doc = activityOf('escursionismo').document
  // Then what is drawn from its data, its profile where it has a track, then what people say.
  assert.deepEqual(doc.slice(0, 3).map(s => s.id), ['descrizione', 'profilo', 'relazioni'])
  assert.equal(doc[0]?.label.it, 'Descrizione')
  assert.deepEqual(doc[0]?.runIns?.map(r => r.id), ['note'])
})

test('a section knows whether it is drawn, written, or waiting for data', () => {
  const kind = (a: string, id: string) =>
    activityOf(a).document.find(s => s.id === id)?.kind

  assert.equal(kind('alpinismo', 'profilo'), 'generated', 'an SVG elevation profile')
  assert.equal(kind('alpinismo', 'descrizione'), 'prose')
  assert.equal(kind('alpinismo', 'relazioni'), 'furniture', 'no data until project 2')
  assert.equal(kind('falesia', 'gradi'), 'generated')
  assert.equal(kind('falesia', 'settori'), 'generated')

  assert.equal(activityOf('falesia').document.find(s => s.id === 'gradi')?.render, 'gradi')
})

test('the two pages differ in their rail, not only in their document', () => {
  assert.deepEqual(activityOf('alpinismo').rail.map(s => s.id),
    ['condizioni', 'vicine', 'foto', 'parcheggio', 'appoggio', 'webcam'])
  // A crag lists no nearby crags: its parking map already pins them.
  assert.deepEqual(activityOf('falesia').rail.map(s => s.id),
    ['condizioni', 'foto', 'parcheggio', 'servizi', 'webcam'])
})

test('a crag has no descent and no gear list; an alpine route has both, inside its description', () => {
  const ids = (a: string) => activityOf(a).document.map(s => s.id)
  const runIns = (a: string) => activityOf(a).document.flatMap(s => s.runIns ?? []).map(r => r.id)
  assert.equal(ids('falesia').includes('discesa'), false)
  assert.equal([...ids('falesia'), ...runIns('falesia')].includes('materiale'), false)
  assert.equal(ids('alpinismo').includes('discesa'), false)
  assert.equal(runIns('alpinismo').includes('discesa'), true)
  assert.equal(runIns('alpinismo').includes('materiale'), true)
})

test('falesia derives two of its facts from its parts, and not a crag-wide length', () => {
  const fal = activityOf('falesia')
  const derived = fal.facts.filter(f => f.derived).map(f => f.id)
  assert.deepEqual(derived, ['gradi', 'vie'])
  assert.equal(fal.facts.some(f => f.id === 'lunghezza'), false, 'length belongs to each via, not the crag')
  assert.deepEqual(fal.facts.find(f => f.id === 'vie')?.derived, { from: 'parts', op: 'count' })
  assert.deepEqual(fal.facts.find(f => f.id === 'gradi')?.derived,
    { from: 'parts', op: 'range', field: 'grado' })
})

test('parts differ per activity: falesia groups its vie, alpinismo numbers optional tiri', () => {
  const fal = activityOf('falesia')
  assert.equal(fal.parts?.label.it, 'Vie')
  assert.equal(fal.parts?.each.it, 'via', 'so a sector with one route reads "1 via"')
  assert.equal(fal.parts?.ordered, false)
  assert.equal(fal.parts?.groupBy?.it, 'Settore')
  assert.deepEqual(fal.parts?.fields.map(f => f.id), ['nome', 'grado', 'lunghezza'])

  const alp = activityOf('alpinismo')
  assert.equal(alp.parts?.label.it, 'Tiri')
  assert.equal(alp.parts?.ordered, true)
  assert.equal(alp.parts?.optional, true)
  assert.equal(alp.parts?.groupBy, undefined, 'tiri are numbered, not grouped')
})

test('no activity asks a report to measure anything', () => {
  for (const id of ['alpinismo', 'falesia']) {
    assert.equal('measures' in activityOf(id), false, id)
    assert.equal('rules' in activityOf(id), false, id)
  }
})

test('when a crag goes into shade is a fact about the wall, not a report', () => {
  const crag = activityOf('falesia')
  const shade = crag.facts.find(f => f.id === 'ombra_dalle')
  assert.equal(shade?.quantity.kind, 'range:timeOfDay',
    'a span, earliest to latest — the hour moves with the seasons')
  assert.equal(shade?.optional, true, 'plenty of crags have never had it written down')
})

test('a generated "gradi" or "settori" section throws at definition time when its part fields are missing', () => {
  const partsWith = (...ids: string[]) => parts({
    label: { it: 'Vie' }, each: { it: 'via' }, ordered: false,
    fields: ids.map(id => fact(id, id === 'grado' ? gradeScale('sport') : text, { label: { it: id } })),
  })

  assert.throws(() => defineActivity({
    id: 'bad-gradi', label: { it: 'Bad' }, facts: [],
    document: [generated('gradi', 'Gradi', 'gradi')], rail: [],
    parts: partsWith('nome'),
    current: { days: 7 },
  }), /"gradi".*"grado"/s)

  assert.throws(() => defineActivity({
    id: 'bad-settori', label: { it: 'Bad' }, facts: [],
    document: [generated('settori', 'Settori', 'settori')], rail: [],
    parts: partsWith('grado'),
    current: { days: 7 },
  }), /"settori".*"nome".*"lunghezza"/s)

  assert.throws(() => defineActivity({
    id: 'bad-no-parts', label: { it: 'Bad' }, facts: [],
    document: [generated('gradi', 'Gradi', 'gradi')], rail: [],
    current: { days: 7 },
  }), /"grado"/, 'an activity with no parts at all still needs the fields a generated section reads')
})

test('a "profilo" section needs no part fields, and a well-formed activity still defines fine', () => {
  assert.doesNotThrow(() => defineActivity({
    id: 'ok-profile', label: { it: 'Ok' }, facts: [],
    document: [generated('profilo', 'Profilo', 'profilo')], rail: [],
    current: { days: 7 },
  }))
  // falesia and alpinismo both pass through defineActivity on import — if the
  // new check had a false positive, every test in this suite would already
  // have failed to import them. This just names the expectation.
  assert.ok(activityOf('falesia'))
  assert.ok(activityOf('alpinismo'))
})

test('defineActivity refuses an access fact id that collides with a header fact id', () => {
  assert.throws(() => defineActivity({
    id: 'test-dup', label: { it: 'Test' },
    facts: [fact('x', text, { label: { it: 'X' } })],
    access: [fact('x', text, { label: { it: 'X again' }, optional: true })],
    document: [], rail: [], current: { days: 7 },
  }), /duplicate fact id "x"/)
})

test('defineActivity refuses an access fact that is not declared optional', () => {
  assert.throws(() => defineActivity({
    id: 'test-required-access', label: { it: 'Test' },
    facts: [],
    access: [fact('y', text, { label: { it: 'Y' } })],
    document: [], rail: [], current: { days: 7 },
  }), /access fact "y" must be optional/)
})

test('an unknown activity fails loudly', () => {
  assert.throws(() => activityOf('parapendio'), UnknownActivity)
  assert.equal(Object.keys(ACTIVITIES).length, 19)
})

test('every activity declares how long a report stays current', () => {
  assert.equal(activityOf('alpinismo').current.days, 7)
  assert.equal(activityOf('falesia').current.days, 14)
})

test('the window is a positive number of days', () => {
  for (const id of ['alpinismo', 'falesia']) {
    assert.ok(activityOf(id).current.days > 0, `${id} declares a usable window`)
  }
})

test('falesia and alpinismo declare the facts their Find row shows, in order', () => {
  assert.deepEqual(activityOf('falesia').row, [
    { kind: 'histogram', field: 'grado' },
    { kind: 'fact', fact: 'vie', icon: 'vie' },
    { kind: 'fact', fact: 'esposizione', icon: 'esp' },
    { kind: 'fact', fact: 'avvicinamento', icon: 'avv' },
  ])
  assert.deepEqual(activityOf('alpinismo').row, [
    { kind: 'fact', fact: 'difficolta', icon: 'grado' },
    { kind: 'fact', fact: 'dislivello', icon: 'dplus' },
    { kind: 'fact', fact: 'esposizione', icon: 'esp' },
    { kind: 'distance' },
  ])
})

test('defineActivity refuses a row that names what the activity does not declare', () => {
  const base = { label: { it: 'T' }, document: [], rail: [], current: { days: 7 } }
  const vie = parts({
    label: { it: 'Vie' }, each: { it: 'via' }, ordered: false,
    fields: [fact('grado', gradeScale('sport'), { label: { it: 'Grado' } }),
             fact('nome', text, { label: { it: 'Nome' } })],
  })

  assert.throws(() => defineActivity({ ...base, id: 't1', facts: [], row: [rowFact('quota', 'dplus')] }),
    /row fact "quota" is not a declared header fact/)
  assert.throws(() => defineActivity({
    ...base, id: 't2', facts: [fact('esposizione', text, { label: { it: 'E' } })],
    row: [rowFact('esposizione', 'esp')],
  }), /compass icon.*"text", not an aspect/)
  assert.throws(() => defineActivity({ ...base, id: 't3', facts: [], parts: vie, row: [histogram('lunghezza')] }),
    /part field "lunghezza", which no part declares/)
  assert.throws(() => defineActivity({ ...base, id: 't4', facts: [], parts: vie, row: [histogram('nome')] }),
    /part field "nome", which is not a grade scale/)
  assert.throws(() => defineActivity({
    ...base, id: 't5', facts: [], row: [distance(), distance(), distance(), distance(), distance()],
  }), /5 items.*4 fact columns/)
  assert.doesNotThrow(() => defineActivity({ ...base, id: 't6', facts: [] }),
    'no row at all is a prose-only activity, and still one file')
})

test('a fact that shows a dash when absent must be optional', () => {
  assert.throws(() => defineActivity({
    id: 'prova', label: { it: 'Prova' },
    facts: [fact('nome', text, { label: { it: 'Nome' }, whenAbsent: 'dash' })],
    document: [], rail: [], current: { days: 7 },
  }), /prova: fact "nome" shows a dash when absent, so it must be optional/)
})

test('every activity is in exactly one family, and only the last family has no name', () => {
  const ids = ACTIVITY_FAMILIES.flatMap(f => f.members.map(a => a.id))
  assert.deepEqual([...ids].sort(), Object.keys(ACTIVITIES).sort())
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(ACTIVITY_FAMILIES.map(f => f.label === null), [false, false, false, false, false, true])
})
