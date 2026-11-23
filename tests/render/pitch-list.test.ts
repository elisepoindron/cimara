import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { pitchList } from '../../src/render/pitch-list.ts'
import { render } from '../../src/render/html.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import type { Part } from '../../src/domain/facts.ts'

const schema = activityOf('multipitch')
const part = (position: number, fields: Record<string, unknown>): Part =>
  ({ id: `p${position}`, group: null, position, fields })
const dom = (h: string) => parseHTML(`<html><body>${h}</body></html>`).document

test('each pitch: its number, grade and length on the left, then its words', () => {
  const doc = dom(render(pitchList(schema, [
    part(2, { grado: '4b', lunghezza: 20, descrizione: 'Fino in cresta.' }),
    part(1, { grado: '6b', lunghezza: 30, descrizione: 'Un diedrino.' }),
  ])!))
  const rows = [...doc.querySelectorAll('ol.tiri li')]
  assert.equal(rows.length, 2)
  assert.deepEqual([...rows[0]!.children].map(c => c.textContent), ['L1', '6b', '30 m', 'Un diedrino.'],
    'in the order they are climbed, not the order handed in')
  assert.equal(rows[0]!.querySelector('em')!.getAttribute('data-grade'), '6')
  assert.equal(rows[1]!.querySelector('em')!.getAttribute('data-grade'), '4')
})

test('a pitch graded between two reads as both, coloured by the lower', () => {
  const doc = dom(render(pitchList(schema, [part(1, { grado: '6b+', grado_fino: '6c', lunghezza: 45 })])!))
  const em = doc.querySelector('em')!
  assert.equal(em.textContent, '6b+/6c')
  assert.equal(em.getAttribute('data-grade'), '6')
})

test('what nobody recorded reads as a dash, not a blank', () => {
  const doc = dom(render(pitchList(schema, [part(1, { descrizione: 'Facile.' })])!))
  assert.equal(doc.querySelectorAll('.nil').length, 2)
  assert.equal(doc.querySelector('em')!.textContent, '—')
})

test('a route that lists no pitches draws no list', () => {
  assert.equal(pitchList(schema, []), null)
})
