import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { html, render } from '../../src/render/html.ts'
import { roadPanel, roadRows } from '../../src/render/access-section.ts'
import { fact } from '../../src/domain/registry.ts'
import { text } from '../../src/domain/quantity.ts'
import type { FactValue } from '../../src/domain/facts.ts'

const dom = (m: string) => parseHTML(`<!doctype html><html><body>${m}</body></html>`).document

const fv = (id: string, it: string, value: string): FactValue =>
  ({ def: fact(id, text, { label: { it }, optional: true }), value, text: value })

const LOCALITA = fv('localita_partenza', 'Località di partenza', 'Pian del Re, 2020 m')
const ARRIVARE = fv('come_arrivare', 'Come arrivare',
  'Da Crissolo, provinciale asfaltata fino al piazzale.')
const TORINO = fv('da_torino', 'Da Torino', '1h50, ultimi 12 km su strada stretta')
const PARCHEGGIO = fv('parcheggio_nota', 'Parcheggio', 'Ampio, a pagamento in alta stagione.')

const labels = (doc: Document) => [...doc.querySelectorAll('.pk__road dt')].map(n => n.textContent)
const words = (doc: Document) => [...doc.querySelectorAll('.pk__road dd')].map(n => n.textContent)

test('the road is always three rows, in a fixed order, whatever order the facts come in', () => {
  const doc = dom(render(roadRows([PARCHEGGIO, LOCALITA, ARRIVARE])))
  assert.deepEqual(labels(doc), ['Partenza', 'Strada', 'Note sul parcheggio'])
  assert.deepEqual(words(doc), [LOCALITA.text, ARRIVARE.text, PARCHEGGIO.text])
})

test('with nothing recorded the three rows are still there, each a dash marked nil', () => {
  const doc = dom(render(roadRows([])))
  assert.deepEqual(labels(doc), ['Partenza', 'Strada', 'Note sul parcheggio'])
  assert.deepEqual(words(doc), ['—', '—', '—'])
  assert.equal(doc.querySelectorAll('.pk__road dd.nil').length, 3)
})

test('a missing row is a dash; the recorded ones are not marked nil', () => {
  const doc = dom(render(roadRows([LOCALITA])))
  assert.deepEqual(words(doc), [LOCALITA.text, '—', '—'])
  assert.equal(doc.querySelectorAll('.pk__road dd.nil').length, 2)
})

test('the parking note is a row like the others, never an alert box', () => {
  const doc = dom(render(roadRows([PARCHEGGIO])))
  assert.equal(doc.querySelectorAll('.alert').length, 0)
  assert.equal(words(doc)[2], PARCHEGGIO.text)
})

test('Da Torino joins the road it continues, so the rows stay three', () => {
  assert.deepEqual(words(dom(render(roadRows([ARRIVARE, TORINO]))))[1],
    `${ARRIVARE.text} Da Torino: ${TORINO.text}`)
  assert.deepEqual(words(dom(render(roadRows([TORINO]))))[1], `Da Torino: ${TORINO.text}`)
})

test('a panel with no points to name is its title and the road, under the id declared', () => {
  const doc = dom(render(roadPanel({ sectionId: 'parcheggio', label: 'Come arrivare' }, roadRows([LOCALITA]))))
  assert.equal(doc.querySelector('section')?.getAttribute('id'), 'parcheggio')
  assert.equal(doc.querySelector('section h2')?.textContent, 'Come arrivare')
  assert.equal(doc.querySelectorAll('section .pk__road').length, 1)
  assert.equal(doc.querySelectorAll('section .pk__pts').length, 0)
  assert.equal(render(roadPanel({ sectionId: 'x', label: 'y' }, html``)).includes('<h2>y</h2>'), true)
})
