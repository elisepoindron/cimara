import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { proseSection } from '../../src/render/prose.ts'
import { ACTIVITIES, activityOf } from '../../src/domain/activities/index.ts'

const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document
const def = (id: string) => activityOf('alpinismo').document.find(s => s.id === id)!

test('a prose section is an id, a heading and paragraphs', () => {
  const doc = dom(render(proseSection(def('descrizione'), 'Primo.\n\nSecondo.')!))
  const section = doc.querySelector('section')

  assert.equal(section?.getAttribute('id'), 'descrizione')
  assert.equal(section?.querySelector('h2')?.textContent, 'Descrizione')
  assert.deepEqual([...doc.querySelectorAll('p')].map(n => n.textContent), ['Primo.', 'Secondo.'])
})

test('a line opening with ## becomes a subheading, as route.html uses', () => {
  const doc = dom(render(proseSection(def('descrizione'), '## Primo tratto\n\nSi sale.')!))
  assert.equal(doc.querySelector('h3')?.textContent, 'Primo tratto')
  assert.equal(doc.querySelector('p')?.textContent, 'Si sale.')
})

test('contributor text cannot become markup', () => {
  const doc = dom(render(proseSection(def('avvicinamento'), 'Attenzione <script>alert(1)</script>')!))
  assert.equal(doc.querySelectorAll('script').length, 0)
  assert.match(doc.querySelector('p')!.textContent!, /<script>/)
})

test('a section with no text renders nothing at all, rather than an empty heading', () => {
  assert.equal(proseSection(def('avvicinamento'), undefined), null)
  assert.equal(proseSection(def('avvicinamento'), '   '), null)
})

const crag = activityOf('falesia').document.find(s => s.id === 'descrizione')!
const crag_ = (note: string | undefined, storia?: string) => proseSection(crag, undefined, { note, storia })

test('a crag has no description, so its note is the description: unlabelled, unquoted', () => {
  const doc = dom(render(crag_('Bella falesia.')!))
  assert.equal(doc.querySelector('h2')?.textContent, 'Descrizione')
  assert.equal(doc.querySelectorAll('section#descrizione > p').length, 1)
  assert.equal(doc.querySelectorAll('.runin').length, 0, 'no Note label on the only text there is')
  assert.equal(doc.querySelectorAll('blockquote').length, 0)
})

test('a crag’s history runs on inside its description, behind a small label', () => {
  const doc = dom(render(crag_('Bella falesia.', 'Chiodata negli anni ’80.')!))
  const ps = [...doc.querySelectorAll('section#descrizione p')]
  assert.equal(ps.length, 2)
  assert.equal(ps[1]!.className, 'runin')
  assert.equal(ps[1]!.querySelector('.lab')?.textContent, 'Storico')
  assert.equal(ps[1]!.textContent, 'StoricoChiodata negli anni ’80.')
  assert.equal(doc.querySelectorAll('h2').length, 1)
  assert.equal(doc.querySelectorAll('h3').length, 0)
})

test('a history of several paragraphs carries its label once', () => {
  const doc = dom(render(crag_('Bella.', 'Primo.\n\nSecondo.')!))
  assert.equal(doc.querySelectorAll('p.runin').length, 2)
  assert.equal(doc.querySelectorAll('p.runin .lab').length, 1)
})

test('no history, and the description is the note alone', () => {
  const doc = dom(render(crag_('Bella falesia.', '  ')!))
  assert.equal(doc.querySelectorAll('p').length, 1)
  assert.equal(doc.querySelectorAll('.runin').length, 0)
})

test('a history alone still draws the description, with only the history in it', () => {
  const doc = dom(render(crag_(undefined, 'Chiodata negli anni ’80.')!))
  assert.equal(doc.querySelectorAll('section#descrizione p.runin').length, 1)
  assert.equal(doc.querySelectorAll('p').length, 1)
})

test('a history is escaped like any prose', () => {
  const doc = dom(render(crag_('Bella.', 'Nota <script>alert(1)</script>')!))
  assert.equal(doc.querySelectorAll('script').length, 0)
  assert.match(doc.querySelector('p.runin')!.textContent!, /<script>/)
})

test('a section with no run-in ignores a history it was handed', () => {
  const doc = dom(render(proseSection(def('avvicinamento'), 'Testo.', { storia: 'Storia.' })!))
  assert.equal(doc.querySelectorAll('.runin').length, 0)
})

const descrizione = activityOf('multipitch').document.find(s => s.id === 'descrizione')!

test('a multi-pitch’s gear and notes run on inside its description, gear first', () => {
  const doc = dom(render(proseSection(descrizione, 'Bella via.', { note: 'Attenzione.', materiale: 'Friend fino al 2.' })!))
  assert.equal(doc.querySelectorAll('h2').length, 1)
  const labels = [...doc.querySelectorAll('section#descrizione p.runin .lab')].map(l => l.textContent)
  assert.deepEqual(labels, ['Materiale', 'Note'])
})

test('a multi-pitch has no Discesa, Note or Materiale section of its own', () => {
  const ids = activityOf('multipitch').document.map(s => s.id)
  assert.equal(ids.includes('discesa'), false)
  assert.equal(ids.includes('note'), false)
  assert.equal(ids.includes('materiale'), false)
})

test('a multi-pitch’s descent runs on inside its description, straight after the way up', () => {
  const doc = dom(render(proseSection(descrizione, 'Bella via.', { discesa: 'In doppia.', materiale: 'Friend.', note: 'Nota.' })!))
  const labels = [...doc.querySelectorAll('section#descrizione p.runin .lab')].map(l => l.textContent)
  assert.deepEqual(labels, ['Discesa', 'Materiale', 'Note'])
})

test('every activity opens its document column on Descrizione', () => {
  for (const a of Object.values(ACTIVITIES)) assert.equal(a.document[0]?.id, 'descrizione', a.id)
})

test('every activity has one Descrizione that carries its note, and no section of its own for it', () => {
  for (const a of Object.values(ACTIVITIES)) {
    const prose = a.document.filter(s => s.kind === 'prose')
    const d = prose.find(s => s.id === 'descrizione')
    assert.equal(d?.label.it, 'Descrizione', a.id)
    assert.equal(d?.lead, 'note', a.id)
    assert.ok(d?.runIns?.some(r => r.id === 'note' && r.label.it === 'Note'), a.id)
    assert.equal(prose.some(s => s.id === 'note'), false, a.id)
  }
})

test('with both texts, the note is a labelled run-in, never the body', () => {
  const ski = activityOf('sci_alpinismo').document.find(s => s.id === 'descrizione')!
  const doc = dom(render(proseSection(ski, 'Si risale il vallone.', { note: 'Carta IGC n. 7.' })!))
  const ps = [...doc.querySelectorAll('section#descrizione p')]
  assert.deepEqual(ps.map(p => p.className), ['', 'runin'])
  assert.equal(ps[1]!.querySelector('.lab')?.textContent, 'Note')
})
