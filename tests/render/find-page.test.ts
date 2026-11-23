import { ACTIVITIES } from '../../src/domain/activities/index.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { findPage, type FindRow } from '../../src/render/find-page.ts'
import { sentenceOf, piecesOf } from '../helpers/find.ts'
import type { Constraint } from '../../src/domain/find/constraints.ts'
import { gradeScale } from '../../src/domain/quantity.ts'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const dom = (m: string) => parseHTML(m).document
const countOf = (doc: Document, s: string) => doc.querySelectorAll(s).length
const attr = (doc: Document, s: string, n: string) =>
  doc.querySelector(s)?.getAttribute(n) ?? null


const row = (over: Partial<FindRow> = {}): FindRow => ({
  ranked: {
    candidate: {
      id: 'i1', name: 'Monviso, Cresta Est', lat: 44.6673, lon: 7.0913,
      gradeMin: 6, gradeMax: 6, gradeScale: 'alpine',
      reports: 8, recent: 3, lastReportAt: '2026-09-14',
    },
    score: 2.1,
    why: 'Te lo proponiamo perché è il più vicino del gruppo.',
  },
  activity: 'alpinismo', where: 'CN Crissolo', isFavorite: false,
  cells: [
    { kind: 'fact', icon: 'grado', label: 'Difficoltà', text: 'AD', aspect: null },
    { kind: 'fact', icon: 'dplus', label: 'Dislivello', text: '2000 m', aspect: null },
    { kind: 'fact', icon: 'esp', label: 'Esposizione', text: 'Sud-Est', aspect: 'SE' },
    { kind: 'distance', km: 62 },
  ],
  ...over,
})

const page = (over: Partial<Parameters<typeof findPage>[0]> = {}) =>
  dom(findPage({ query: '', constraints: [], rows: [], total: 0, now: NOW, ...over }))

test('the sentence reads back what was understood, one slot per piece', () => {
  const constraints: Constraint[] = [
    { kind: 'activity', id: 'alpinismo', label: 'Alpinismo', inferred: false },
    { kind: 'near', placeId: 'p1', placeName: 'Torino', withinKm: 80 },
  ]
  const doc = page({ constraints })

  assert.equal(sentenceOf(doc), 'Cerco vie di alpinismo entro 80 km da Torino')
  assert.deepEqual(piecesOf(doc), ['Alpinismo', 'entro 80 km da', 'Torino'],
    'and each slot holds its piece as the parser reads it, so the form posts back a line')
})

test('a part Find worked out for itself is marked as inferred', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'alpinismo', label: 'Alpinismo', inferred: true },
    { kind: 'grade', scale: 'alpine', min: 0, max: 6, written: 'fino a AD' },
  ] })

  assert.equal(countOf(doc, '.q__s select.slot--inf'), 1, 'a grade named this activity; the visitor did not')
  assert.equal(sentenceOf(doc), 'Cerco vie di alpinismo di grado fino al AD')
})

test('a fact phrase reads back as the visitor spelled it, after the activity it inferred', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: true },
    { kind: 'fact', activities: ['falesia'], id: 'con_la_pioggia', match: 'is', value: true, written: 'con la pioggia' },
  ] })

  assert.equal(sentenceOf(doc), 'Cerco falesie con la pioggia')
  assert.equal(attr(doc, '.q__s .slot--x input', 'value'), 'con la pioggia')
  assert.equal(attr(doc, '.q__s .slot--x input', 'checked'), '', 'kept while ticked')
})

test('with nothing asked for it says so, rather than showing an empty sentence', () => {
  const doc = page()
  assert.match(doc.querySelector('.q__s')!.textContent!, /archivio/)
})

test('the count line says how many, and whether a radius narrowed them', () => {
  assert.equal(page({ total: 14 }).querySelector('.list__h b')!.textContent, '14 itinerari')
  assert.equal(page({ total: 1 }).querySelector('.list__h b')!.textContent, '1 itinerario')

  const narrowed = page({ total: 14, constraints: [
    { kind: 'near', placeId: 'p', placeName: 'Torino', withinKm: 80 }] })
  assert.equal(narrowed.querySelector('.list__h b')!.textContent, '14 itinerari in questo raggio')
})

test('a row carries its name, where it is, and how much has been written', () => {
  const doc = page({ rows: [row()], total: 1 })

  assert.equal(attr(doc, 'a.r__link', 'href'), '/itinerario/i1')
  assert.equal(attr(doc, '.r', 'data-id'), 'i1', 'so the list can follow its pin on the map')
  assert.equal(doc.querySelector('a.r__link')!.textContent, 'Monviso, Cresta Est')
  assert.equal(doc.querySelector('.r__n small')!.textContent, 'CN Crissolo', 'beside the name')
  assert.equal(attr(doc, '.r__bar', 'style'), 'background:var(--rule)',
    'the bar no longer ranks the list by colour')
  assert.equal(doc.querySelector('.r__s b')!.textContent, '8 relazioni')
  assert.equal(doc.querySelector('.r__s > span')!.textContent, 'l’ultima ieri')
  assert.equal(countOf(doc, '.r__s .vw'), 0, 'no verdict word, and no colour')
  assert.equal(countOf(doc, '.r__why'), 0, 'the design took the ranking sentence out')
})

test('a row shows distance, because drive time needs a routing service', () => {
  const doc = page({ rows: [row()], total: 1 })
  const line = doc.querySelector('.r__f')!.textContent!

  assert.match(line, /62 km/)
  assert.doesNotMatch(line, /Auto|1h0/, 'the design asks for drive time; the spec says why not')
})

test('a list of one activity lines its facts up, and draws its icons once', () => {
  const doc = page({ rows: [row(), row({ where: 'CN Pontechianale' })], total: 2 })
  const first = [...doc.querySelectorAll('.r')][0]!

  assert.equal(attr(doc, '.list', 'class'), 'list list--facts')
  assert.equal(countOf(doc, 'svg.icons'), 1)
  assert.deepEqual([...first.querySelectorAll('.r__f svg.ic')].map(s => s.getAttribute('aria-label')),
    ['Difficoltà', 'Dislivello', 'Esposizione', 'Distanza'])
})

test('a list that mixes activities keeps one even gap instead', () => {
  const crag = row({ activity: 'falesia', cells: [null,
    { kind: 'fact', icon: 'vie', label: 'Vie', text: '3', aspect: null }] })
  const doc = page({ rows: [row(), crag], total: 2 })

  assert.equal(attr(doc, '.list', 'class'), 'list',
    'a route’s grade and a crag’s histogram must not share a column')
  assert.equal([...doc.querySelectorAll('.r')][1]!.querySelectorAll('.r__f > div').length, 1,
    'unaligned, an empty slot is left out')
})

test('a route nobody has reported on still renders, and says so', () => {
  const ungraded = row()
  const doc = page({ total: 1, rows: [{
    ...ungraded,
    ranked: { ...ungraded.ranked, candidate: {
      ...ungraded.ranked.candidate,
      reports: 0, recent: 0, lastReportAt: null } },
  }] })

  assert.equal(doc.querySelector('.r__s b')!.textContent, 'Da raccontare')
  assert.equal(doc.querySelector('.r__s > span')!.textContent, 'nessuna relazione')
})

test('an empty result set says nothing found rather than showing an empty list', () => {
  const doc = page({ query: 'niente', total: 0 })
  assert.equal(countOf(doc, '.r'), 0)
  assert.match(doc.querySelector('.list p')!.textContent!, /Nessun itinerario/)
  assert.equal(attr(doc, '.list', 'class'), 'list')
  assert.equal(countOf(doc, 'svg.icons'), 0)
})

test('the map shows the results and nothing else', () => {
  const doc = page({ rows: [row()], total: 1 })
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!) as { id: string }[]
  assert.deepEqual(data.map(p => p.id), ['i1'])
})

test('what was not read comes back as a name slot, so a wrong parse is visible', () => {
  const doc = page({ query: 'zqxwibble', constraints: [{ kind: 'name', text: 'zqxwibble' }] })
  assert.equal(sentenceOf(doc), 'Cerco itinerari che si chiamano zqxwibble')
})

test('every menu offers only what the parser reads back', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'grade', scale: 'sport', min: 0, max: 7, written: 'fino a 6a' },
    { kind: 'near', placeId: 'p1', placeName: 'Torino', withinKm: 35 },
  ] })
  const values = (label: string) =>
    [...doc.querySelectorAll(`select[aria-label="${label}"] option`)].map(o => o.getAttribute('value'))

  assert.deepEqual(values('Attività'), ['', ...Object.values(ACTIVITIES).map(a => a.label.it)])
  assert.ok(values('Grado da').includes('dal 6b'))
  assert.ok(values('Grado a').includes('al 7b'))
  assert.ok(values('Distanza').includes('entro 35 km da'), 'the distance asked is among the offers')
  assert.ok(values('Distanza').includes('entro 10 km da'))
})

test('shelter from rain is offered as shelter, not as rain', () => {
  const doc = page({ constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }] })
  const buttons = [...doc.querySelectorAll('button.q__add')].map(b => b.getAttribute('value'))
  assert.ok(buttons.includes('al riparo dalla pioggia'), buttons.join(', '))
  assert.ok(!buttons.includes('con la pioggia'), buttons.join(', '))
})

test('the additions are one control per kind, minus what was asked', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'fact', activities: ['falesia'], id: 'con_la_pioggia', match: 'is', value: true, written: 'quando piove' },
  ] })
  const menus = [...doc.querySelectorAll('select.q__add')].map(m => m.getAttribute('aria-label'))
  const buttons = [...doc.querySelectorAll('button.q__add')].map(b => b.getAttribute('value'))

  assert.deepEqual(menus, ['Aggiungi senza pioggia', 'Aggiungi grado', 'Aggiungi vie', 'Aggiungi esposizione',
    'Aggiungi avvicinamento', 'Aggiungi parete', 'Aggiungi roccia', 'Aggiungi stagione'])
  assert.deepEqual(buttons, ['per famiglie'], 'shelter from rain was asked already, in another spelling')
  const seasons = [...doc.querySelectorAll('select[aria-label="Aggiungi stagione"] option')].map(o => o.getAttribute('value'))
  assert.deepEqual(seasons, ['', 'primaverile', 'estiva', 'autunnale', 'invernale'])
  const grades = [...doc.querySelectorAll('select[aria-label="Aggiungi grado"] option')].map(o => o.getAttribute('value'))
  assert.ok(grades.includes('dal 6a'))
})

test('with no activity there is nothing to add', () => {
  const doc = page({ constraints: [{ kind: 'name', text: 'Cresta' }] })
  assert.equal(countOf(doc, 'select.q__add'), 0)
})

test('asked to write freely, the open line holds the line searched, the rewrite if there was one', () => {
  const doc = page({ query: 'falaise avitino Torine', free: true,
    constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }],
    reading: { rewritten: 'falesia entro 80 km da Torino', ignored: null } })

  assert.equal(attr(doc, 'input#q', 'value'), 'falesia entro 80 km da Torino')
  assert.equal(countOf(doc, '.q__s'), 0, 'one form of the question at a time')
  assert.equal(attr(doc, '.q__back', 'href'), '/trova?q=falesia%20entro%2080%20km%20da%20Torino')
})

test('markup typed into the field arrives as text, not as markup', () => {
  const hostile = '"><script>alert(1)</script><img src=x onerror=alert(2)>'
  const doc = page({ query: hostile, constraints: [{ kind: 'name', text: hostile }] })

  assert.equal(countOf(doc, 'script'), 7,
    'the shell’s three motion scripts, the page’s live module and its sheet, and the map’s data and module scripts — nothing the query opened')
  assert.equal(countOf(doc, 'img'), 1, 'the header’s logo — nothing the query opened')
  assert.equal(countOf(doc, '[onerror]'), 0)
  assert.deepEqual(piecesOf(doc), ['', hostile], 'and it round-trips verbatim')
})

test('a route name cannot become markup either', () => {
  const evil = row()
  const doc = page({ total: 1, rows: [{
    ...evil,
    ranked: { ...evil.ranked, candidate: {
      ...evil.ranked.candidate, name: '<script>alert(1)</script>' } },
  }] })

  assert.equal(countOf(doc, 'script'), 7,
    'the shell’s three motion scripts, the page’s live module and its sheet, and the map’s data and module scripts — nothing the name opened')
  assert.match(doc.querySelector('.r__n')!.textContent!, /<script>/)
})

test('the form is a GET, so a search is a link somebody can send', () => {
  const doc = page({ free: true })
  assert.equal(attr(doc, 'form', 'method'), 'get')
  assert.equal(attr(doc, 'form', 'action'), '/trova')
})

test('one report is counted in the singular, and dated', () => {
  const base = row()
  const doc = page({ total: 1, rows: [{ ...base, ranked: { ...base.ranked, candidate: {
    ...base.ranked.candidate, reports: 1, recent: 1, lastReportAt: '2026-09-14' } } }] })

  assert.equal(doc.querySelector('.r__s b')!.textContent, '1 relazione')
  assert.equal(doc.querySelector('.r__s > span')!.textContent, 'ieri')
})

test('a favorited row shows the filled star, posting to remove it', () => {
  const doc = page({
    rows: [row({ isFavorite: true })], total: 1, query: 'alpinismo',
    viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok',
  })

  assert.equal(doc.querySelector('.r button.fav--on') !== null, true)
  assert.equal(attr(doc, '.r form', 'action'), '/preferiti/i1/rimuovi')
  assert.equal(attr(doc, '.r form input[name=next]', 'value'), '/trova?q=alpinismo')
})

test('signed out, a row still offers the star, as a link to sign in', () => {
  const doc = page({ rows: [row()], total: 1, query: 'alpinismo' })
  assert.equal(attr(doc, '.r a.fav', 'href'), '/accedi?next=%2Ftrova%3Fq%3Dalpinismo')
})

test('a rewrite is tagged and quotes the line typed; words set aside are named', () => {
  const doc = page({
    query: 'falaise avitino Torine',
    constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }],
    reading: { rewritten: 'falesia entro 80 km da Torino', ignored: 'avitino' },
  })
  const note = doc.querySelector('.q__n')!.textContent!.replace(/\s+/g, ' ').trim()
  assert.equal(note,
    'Riletta Avevi scritto falaise avitino Torine Non ho capito avitino e l’ho lasciato da parte. scrivi liberamente')
  assert.equal(attr(doc, '.q__free', 'href'), '/trova?q=falaise%20avitino%20Torine&scrivi=1')
})

test('a question answered as typed carries only the way to the open line', () => {
  const doc = page({ query: 'falesia', reading: { rewritten: null, ignored: null },
    constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }] })
  assert.equal(countOf(doc, '.q__tag'), 0)
  assert.equal(doc.querySelector('.q__n')!.textContent!.trim(), 'scrivi liberamente')
})

test('what the model wrote is escaped like anything a visitor typed', () => {
  const doc = page({ query: '<b>x</b>', free: true, reading: { rewritten: '"><b>x</b>', ignored: '<i>y</i>' } })
  assert.equal(countOf(doc, 'section.q b'), 0)
  assert.equal(attr(doc, 'input#q', 'value'), '"><b>x</b>')

  const slotted = page({ query: '<b>x</b>', reading: { rewritten: 'falesia', ignored: '<i>y</i>' },
    constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }] })
  assert.equal(countOf(slotted, '.q__n b'), 0)
  assert.equal(countOf(slotted, '.q__n i'), 0)
})

test('the sentence is a GET form of its pieces, with its own script', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'near', placeId: 'p1', placeName: 'Torino', withinKm: 80 },
    { kind: 'name', text: 'Cresta Est' },
  ] })

  assert.equal(attr(doc, 'form.q__f', 'method'), 'get')
  assert.equal(attr(doc, 'form.q__f', 'action'), '/trova')
  assert.deepEqual(piecesOf(doc), ['Falesia', 'entro 80 km da', 'Torino', 'Cresta Est'])
  assert.equal(countOf(doc, 'form.q__f button.btn[type="submit"]'), 1, 'it works with no script, through its button')
  assert.equal(doc.querySelector('form.q__f button[type="submit"]')?.className, 'btn',
    'and Search is the form’s first submit button, so Enter never submits an addition')
  assert.equal(attr(doc, 'script[src^="/find-live.js"]', 'type'), 'module')
})


test('the grade is its two ends, each open where the range is', () => {
  const sel = (doc: Document, label: string) =>
    doc.querySelector(`select[aria-label="${label}"] option[selected]`)?.getAttribute('value')
  // Positions looked up on the scale, never written as numbers: the scale has
  // gained steps before, and a test that counts them breaks for nothing.
  const o = (g: string) => gradeScale('sport').ordinal(g)
  const at = (min: number, max: number, written: string) => page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'grade', scale: 'sport', min, max, written },
  ] })

  const range = at(o('6a'), o('7c+'), 'dal 6a al 7c+')
  assert.equal(sentenceOf(range), 'Cerco falesie di grado dal 6a al 7c+')
  assert.deepEqual([sel(range, 'Grado da'), sel(range, 'Grado a')], ['dal 6a', 'al 7c+'])

  const floor = at(o('6a+'), o('9a'), 'dal 6a+ in su')
  assert.equal(sentenceOf(floor), 'Cerco falesie di grado dal 6a+ in su')
  assert.deepEqual([sel(floor, 'Grado da'), sel(floor, 'Grado a')], ['dal 6a+', ''])

  const ceiling = at(0, o('6a'), 'fino a 6a')
  assert.equal(sentenceOf(ceiling), 'Cerco falesie di grado fino al 6a')
  assert.deepEqual([sel(ceiling, 'Grado da'), sel(ceiling, 'Grado a')], ['', 'al 6a'])
})

test('a fact that holds one value at a time is offered until one is asked; seasons add up', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'fact', activities: ['falesia'], id: 'esposizione', match: 'is', value: 'S', written: 'esposte a sud' },
    { kind: 'fact', activities: ['falesia'], id: 'stagione', match: 'includes', value: 'inverno', written: 'invernale' },
  ] })
  const menus = [...doc.querySelectorAll('select.q__add')].map(m => m.getAttribute('aria-label'))
  assert.equal(menus.includes('Aggiungi esposizione'), false, 'a wall faces one way')
  const seasons = [...doc.querySelectorAll('select[aria-label="Aggiungi stagione"] option')].map(o => o.getAttribute('value'))
  assert.deepEqual(seasons, ['', 'primaverile', 'estiva', 'autunnale'])
})

test('a dry spell is offered to every activity, and reads back as a slot; conditions are not', () => {
  const offered = page({ constraints: [{ kind: 'activity', id: 'alpinismo', label: 'Alpinismo', inferred: false }] })
  const menus = [...offered.querySelectorAll('select.q__add')].map(m => m.getAttribute('aria-label'))
  assert.equal(menus.includes('Aggiungi condizioni'), false, 'nothing grades a route, so nothing to ask')
  assert.ok(menus.includes('Aggiungi senza pioggia'))

  const asked = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'dry', days: 3, written: 'senza pioggia da 3 giorni' },
  ] })
  assert.equal(sentenceOf(asked), 'Cerco falesie senza pioggia da 3 giorni')
  const left = [...asked.querySelectorAll('select.q__add')].map(m => m.getAttribute('aria-label'))
  assert.equal(left.includes('Aggiungi senza pioggia'), false)
})

test('narrowed to a view, the header counts the routes on the map and the rest as one number', () => {
  const doc = page({ query: 'Monviso', rows: [row()], total: 12, totalAll: 40, view: '7,44,8,45' })
  assert.equal(doc.querySelector('.list__h b')!.textContent, '12 itinerari sulla carta')
  assert.match(doc.querySelector('.list__out')!.textContent!, /^28 fuori dalla carta · Mostra tutti$/)
  assert.equal(attr(doc, 'a.list__all', 'href'), '/trova?q=Monviso', 'back to the whole map: the view is dropped')
})

test('a view that holds every match is the plain count', () => {
  const doc = page({ rows: [row()], total: 3, totalAll: 3, view: '7,44,8,45' })
  assert.equal(doc.querySelector('.list__h b')!.textContent, '3 itinerari')
  assert.equal(doc.querySelectorAll('.list__out').length, 0)
})

test('an empty view says so, rather than that nothing answers the question', () => {
  const doc = page({ rows: [], total: 0, totalAll: 9, view: '7,44,8,45' })
  assert.equal(doc.querySelector('.r__why')!.textContent, 'Nessun itinerario in questa parte della carta.')
})

test('the pages are links that keep the line and the view', () => {
  const doc = page({ query: 'Monviso', rows: [row()], total: 200, page: 4, pages: 10, view: '7,44,8,45' })
  const links = [...doc.querySelectorAll('.pages a')]
  assert.deepEqual(links.map(a => a.textContent), ['‹', '1', '3', '4', '5', '10', '›'])
  assert.equal(attr(doc, '.pages a[aria-current="page"]', 'href'), '/trova?q=Monviso&vista=7%2C44%2C8%2C45&pagina=4')
  assert.equal(attr(doc, '.pages a[rel="prev"]', 'href'), '/trova?q=Monviso&vista=7%2C44%2C8%2C45&pagina=3')
  assert.equal(doc.querySelectorAll('.pages__gap').length, 2)
})

test('one page has no pager', () => {
  assert.equal(page({ rows: [row()], total: 1, page: 1, pages: 1 }).querySelectorAll('.pages').length, 0)
})

test('the map has a pin for every match, and only the page’s pins carry a full card', () => {
  const doc = page({
    rows: [row()], total: 2,
    points: [
      { id: 'i1', name: 'Monviso, Cresta Est', lat: 44.67, lon: 7.09, activity: 'alpinismo', placeName: 'Crissolo' },
      { id: 'i2', name: 'Altrove', lat: 45, lon: 7.5, activity: 'falesia', placeName: 'Bussoleno' },
    ],
  })
  const pins = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(pins.map((p: { id: string }) => p.id), ['i1', 'i2'])
  assert.ok(pins[0].recap.state, 'the row on the page: its reports on the card')
  assert.deepEqual(pins[1].recap, { kind: 'Falesia', where: 'Bussoleno', facts: [] })
})

test('the activity menu comes in its families, each activity saying its id', () => {
  const doc = page({ constraints: [{ kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false }] })
  const groups = [...doc.querySelectorAll('select[aria-label="Attività"] optgroup')].map(g => g.getAttribute('label'))
  assert.deepEqual(groups, ['Neve e ghiaccio', 'Roccia', 'Terra', 'Acqua', 'Aria'])
  assert.equal(attr(doc, 'select[aria-label="Attività"] option[value="Falesia"]', 'data-act'), 'falesia')
  assert.equal(countOf(doc, 'select[aria-label="Attività"] > option'), 2, 'itinerari, and Altro, which has no family')
})

test('the grade menus are paired as one range, each sport step carrying its band', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'falesia', label: 'Falesia', inferred: false },
    { kind: 'grade', scale: 'sport', min: 13, max: 19, written: 'dal 6a al 7a' },
  ] })
  assert.equal(attr(doc, 'select[aria-label="Grado da"]', 'data-range'), 'lo')
  assert.equal(attr(doc, 'select[aria-label="Grado a"]', 'data-range'), 'hi')
  assert.equal(attr(doc, 'select[aria-label="Grado da"] option[value="dal 6a+"]', 'data-grade'), '6')
  assert.equal(attr(doc, 'select[aria-label="Grado a"] option[value=""]', 'data-grade'), null, 'the open end has no band')
})

test('an alpine grade has no band to carry', () => {
  const doc = page({ constraints: [
    { kind: 'activity', id: 'alpinismo', label: 'Alpinismo', inferred: false },
    { kind: 'grade', scale: 'alpine', min: 2, max: 6, written: 'dal PD- al AD' },
  ] })
  assert.equal(countOf(doc, 'select[data-range] option[data-grade]'), 0)
})
