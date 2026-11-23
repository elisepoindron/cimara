import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { partsList } from '../../src/render/parts-list.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import type { Part } from '../../src/domain/facts.ts'

const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document

const via = (n: number, nome: string, grado: string, lunghezza: number, group: string | null): Part =>
  ({ id: `v${n}`, group, position: n, fields: { nome, grado, lunghezza } })

test('sectors become headings, in the order they first appear, with their counts', () => {
  const doc = dom(render(partsList(activityOf('falesia'), [
    via(1, 'Primo sole',  '6a',  22, 'Basso'),
    via(2, 'Corda tesa',  '7a',  24, 'Basso'),
    via(3, 'Il compito',  '6b',  15, 'Scuola'),
  ])!))

  assert.deepEqual([...doc.querySelectorAll('h3')].map(n => n.textContent),
    ['Settore Basso, 2 vie', 'Settore Scuola, 1 via'])
  assert.equal(doc.querySelectorAll('div.routes').length, 2)
})

test('a row is name, length, grade — the order crag.html renders', () => {
  const doc = dom(render(partsList(activityOf('falesia'),
    [via(1, 'Primo sole', '6a', 22, 'Basso')])!))
  const row = doc.querySelector('.routes > div')!

  assert.equal(row.querySelector('span')?.textContent, 'Primo sole')
  assert.equal(row.querySelector('b')?.textContent, '22 m')
  assert.equal(row.querySelector('em')?.textContent, '6a')
})

test('a via nobody graded shows a dash where its grade would be', () => {
  const ungraded: Part = { id: 'v1', group: null, position: 1, fields: { nome: 'Variante', lunghezza: 8 } }
  const doc = dom(render(partsList(activityOf('falesia'), [ungraded])!))
  assert.equal(doc.querySelector('.routes > div em')?.textContent, '—')
})

test('a via nobody named shows a dash where its name would be, and keeps its grade', () => {
  const nameless: Part = { id: 'v1', group: null, position: 1, fields: { grado: '6a', lunghezza: 12 } }
  const doc = dom(render(partsList(activityOf('falesia'), [nameless])!))
  const row = doc.querySelector('.routes > div')!

  assert.equal(row.querySelector('span')?.textContent, '—')
  assert.equal(row.querySelector('b')?.textContent, '12 m')
  assert.equal(row.querySelector('em')?.textContent, '6a')
})

test('a via whose length nobody recorded shows a dash, not an empty cell', () => {
  const unmeasured: Part = { id: 'v1', group: null, position: 1, fields: { nome: 'Senza misura', grado: '6a' } }
  const doc = dom(render(partsList(activityOf('falesia'), [unmeasured])!))
  const row = doc.querySelector('.routes > div')!

  assert.equal(row.querySelector('b')?.textContent, '—')
  assert.equal(row.querySelector('em')?.textContent, '6a')
})

test('a crag without sectors lists its vie flat, with no headings', () => {
  const doc = dom(render(partsList(activityOf('falesia'), [
    via(1, 'Unica', '5c', 12, null), via(2, 'Altra', '6a', 14, null),
  ])!))

  assert.equal(doc.querySelectorAll('h3').length, 0)
  assert.equal(doc.querySelectorAll('div.routes').length, 1)
  assert.equal(doc.querySelectorAll('.routes > div').length, 2)
})

test('an activity with no parts renders nothing', () => {
  assert.equal(partsList(activityOf('falesia'), []), null)
})

test('a mix of grouped and ungrouped vie puts the ungrouped ones first, headingless, never under a blank sector', () => {
  const markup = render(partsList(activityOf('falesia'), [
    via(1, 'Libera',      '5c', 10, null),
    via(2, 'Primo sole',  '6a', 22, 'Basso'),
    via(3, 'Corda tesa',  '7a', 24, 'Basso'),
  ])!)
  const doc = dom(markup)

  assert.deepEqual([...doc.querySelectorAll('h3')].map(n => n.textContent), ['Settore Basso, 2 vie'])
  assert.equal(doc.querySelectorAll('div.routes').length, 2)
  const [first] = doc.querySelectorAll('div.routes')
  assert.deepEqual([...first!.querySelectorAll('span')].map(n => n.textContent), ['Libera'])
  assert.ok(markup.indexOf('Libera') < markup.indexOf('<h3>'),
    'the ungrouped via renders ahead of any sector heading')
})

test('a blank-string group is ungrouped, not a sector named ""', () => {
  const markup = render(partsList(activityOf('falesia'), [
    via(1, 'Libera',      '5c', 10, ''),
    via(2, 'Primo sole',  '6a', 22, 'Basso'),
  ])!)
  const doc = dom(markup)

  assert.deepEqual([...doc.querySelectorAll('h3')].map(n => n.textContent), ['Settore Basso, 1 via'])
  assert.ok(!markup.includes('Settore ,'), 'no heading for a blank sector')
  const [first] = doc.querySelectorAll('div.routes')
  assert.deepEqual([...first!.querySelectorAll('span')].map(n => n.textContent), ['Libera'])
})

test('a field the parts do not declare throws, rather than rendering a blank cell', () => {
  const tiro: Part = { id: 't1', group: null, position: 1, fields: { numero: 1, grado: 'AD' } }
  assert.throws(() => partsList(activityOf('alpinismo'), [tiro]), /alpinismo/)
  assert.throws(() => partsList(activityOf('alpinismo'), [tiro]), /"nome"/)
})

test('a graded via\'s grade label carries its band; an ungraded one carries none', () => {
  const doc = dom(render(partsList(activityOf('falesia'),
    [via(1, 'Primo sole', '7b+', 22, null), { id: 'v2', group: null, position: 2, fields: { nome: 'Senza grado', lunghezza: 20 } }])!))
  const ems = [...doc.querySelectorAll('.routes em')]

  assert.equal(ems[0]!.getAttribute('data-grade'), '7')
  assert.equal(ems[1]!.hasAttribute('data-grade'), false)
})
