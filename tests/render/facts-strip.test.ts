import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { factsStrip } from '../../src/render/facts-strip.ts'
import { breadcrumb } from '../../src/render/breadcrumb.ts'
import { resolveFacts } from '../../src/domain/facts.ts'
import { defineActivity, fact } from '../../src/domain/registry.ts'
import { boolean, text } from '../../src/domain/quantity.ts'
import { activityOf } from '../../src/domain/activities/index.ts'

function dom(markup: string) {
  return parseHTML(`<!doctype html><body>${markup}</body>`).document
}

test('the alpine facts strip carries route.html six labels, in order', () => {
  const values = resolveFacts(activityOf('alpinismo'), {
    difficolta: 'AD', dislivello: 2000, partenza: 2020,
    vetta: 3841, esposizione: 'SE', giorni: 2,
  }, [])
  const doc = dom(render(factsStrip(values)))

  assert.equal(doc.querySelectorAll('dl.cls').length, 1)
  assert.deepEqual([...doc.querySelectorAll('dl.cls dt')].map(n => n.textContent),
    ['Difficoltà', 'Dislivello', 'Partenza', 'Vetta', 'Esposizione', 'Giorni'])
  assert.deepEqual([...doc.querySelectorAll('dl.cls dd')].map(n => n.textContent),
    ['AD', '2000 m', '2020 m', '3841 m', 'Sud-Est', '2'])
})

test('the crag facts strip is a different strip, from the same code', () => {
  const parts = [1, 2, 3].map(n => ({
    id: `v${n}`, group: null, position: n,
    fields: { nome: `Via ${n}`, grado: ['6a', '7c', '6b+'][n - 1]!, lunghezza: [14, 34, 20][n - 1]! },
  }))
  const values = resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20 }, parts)
  const doc = dom(render(factsStrip(values)))

  assert.deepEqual([...doc.querySelectorAll('dt')].map(n => n.textContent),
    ['Gradi', 'Vie', 'Esposizione', 'Quota base', 'Avvicinamento',
     'Parete', 'Roccia', 'Stagione', 'Con la pioggia', 'Per famiglie'])
  assert.equal(doc.querySelector('dd')?.textContent, '6a a 7c')
})

test('a crag nobody has rated still lists every guidebook label, with dashes', () => {
  const parts = [{ id: 'v1', group: null, position: 1, fields: { nome: 'Via 1', grado: '6a', lunghezza: 14 } }]
  const values = resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20 }, parts)
  const doc = dom(render(factsStrip(values)))
  assert.deepEqual([...doc.querySelectorAll('dd')].slice(5).map(n => n.textContent),
    ['—', '—', '—', '—', '—'])
  assert.equal(values.filter(v => v.def.placement === 'giudizi').map(v => v.text).join(' '),
    '— — — — —', 'the five ratings resolve too, for the rail to draw')
})

test('a rating out of range stops the crag, naming the fact', () => {
  const parts = [{ id: 'v1', group: null, position: 1, fields: { nome: 'Via 1', grado: '6a', lunghezza: 14 } }]
  assert.throws(() => resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20, bellezza: 6 }, parts),
    /bellezza: stars: expected a whole number from 1 to 5, got 6/)
})

test('the breadcrumb reads activity then place, root first', () => {
  const doc = dom(render(breadcrumb(activityOf('alpinismo'), [
    { id: '1', name: 'Piemonte', kind: 'regione',   parentId: null },
    { id: '2', name: 'CN',       kind: 'provincia', parentId: '1' },
    { id: '3', name: 'Crissolo', kind: 'comune',    parentId: '2' },
  ])))

  const crumb = doc.querySelector('.crumb')
  assert.ok(crumb?.classList.contains('lab'))
  // Given no Find lines, only the activity is a link (see tests/render/breadcrumb.test.ts).
  assert.deepEqual([...doc.querySelectorAll('.crumb a')].map(a => a.textContent), ['Alpinismo'])
  assert.match(crumb!.textContent!, /Alpinismo \/ Piemonte \/ CN \/ Crissolo/)
})

const placed = defineActivity({
  id: 'prova', label: { it: 'Prova' },
  facts: [
    fact('parete', text, { label: { it: 'Parete' }, optional: true, whenAbsent: 'dash' }),
    fact('sassi', boolean, { label: { it: 'Caduta sassi' }, optional: true, whenAbsent: 'dash', warnIf: true }),
    fact('bellezza', text, { label: { it: 'Bellezza' }, optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
  ],
  document: [], rail: [], current: { days: 7 },
})

test('the strip leaves out what is placed elsewhere, and dashes what is absent', () => {
  const doc = dom(render(factsStrip(resolveFacts(placed, {}, []))))
  assert.deepEqual([...doc.querySelectorAll('dt')].map(n => n.textContent), ['Parete', 'Caduta sassi'])
  assert.deepEqual([...doc.querySelectorAll('dd')].map(n => n.textContent), ['—', '—'])
})

test('a warning value is written, marked, and only when it is the warning', () => {
  const on = dom(render(factsStrip(resolveFacts(placed, { sassi: true }, []))))
  assert.equal(on.querySelectorAll('dd.warn').length, 1)
  assert.equal(on.querySelector('dd.warn')!.textContent, 'Sì')
  assert.equal(on.querySelectorAll('dd.warn svg').length, 1)

  const off = dom(render(factsStrip(resolveFacts(placed, { sassi: false }, []))))
  assert.equal(off.querySelectorAll('dd.warn').length, 0)
  assert.equal([...off.querySelectorAll('dd')].map(n => n.textContent)[1], 'No')
})
