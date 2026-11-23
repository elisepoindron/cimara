import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { breadcrumb } from '../../src/render/breadcrumb.ts'
import { activityOf } from '../../src/domain/activities/index.ts'

const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document

const PLACES = [
  { id: '1', name: 'Piemonte', kind: 'regione', parentId: null },
  { id: '2', name: 'CN', kind: 'provincia', parentId: '1' },
  { id: '3', name: 'Crissolo', kind: 'comune', parentId: '2' },
]

test('the activity is a link to Find; a place with no line is plain text', () => {
  const doc = dom(render(breadcrumb(activityOf('alpinismo'), PLACES)))

  assert.equal(doc.querySelectorAll('.crumb a').length, 1, 'only the activity is a control')
  assert.equal(doc.querySelector('.crumb a')?.getAttribute('href'), '/trova?q=Alpinismo')
  assert.equal(doc.querySelector('.crumb a')?.textContent, 'Alpinismo')
  assert.equal(doc.querySelector('.crumb')?.textContent, 'Alpinismo / Piemonte / CN / Crissolo')
})

test('each place with a line links to Find with that line, the others stay text', () => {
  const lines = new Map([['1', 'Alpinismo Piemonte'], ['3', 'Alpinismo Crissolo']])
  const doc = dom(render(breadcrumb(activityOf('alpinismo'), PLACES, lines)))

  const links = [...doc.querySelectorAll('.crumb a')]
  assert.deepEqual(links.map(a => a.textContent), ['Alpinismo', 'Piemonte', 'Crissolo'])
  assert.deepEqual(links.map(a => a.getAttribute('href')),
    ['/trova?q=Alpinismo', '/trova?q=Alpinismo%20Piemonte', '/trova?q=Alpinismo%20Crissolo'])
  assert.equal(doc.querySelector('.crumb')?.textContent, 'Alpinismo / Piemonte / CN / Crissolo')
})

test('with no places, the breadcrumb is just the activity link', () => {
  const doc = dom(render(breadcrumb(activityOf('falesia'), [])))
  assert.equal(doc.querySelector('.crumb')?.textContent, 'Falesia')
  assert.equal(doc.querySelectorAll('.crumb a').length, 1)
})
