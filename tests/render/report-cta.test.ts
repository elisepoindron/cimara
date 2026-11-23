import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { reportCta } from '../../src/render/report-cta.ts'

const dom = (m: string) => parseHTML(`<div>${m}</div>`).document
const attr = (doc: Document, s: string, n: string) => doc.querySelector(s)?.getAttribute(n) ?? null

test('an icon button, named for whoever cannot see the bubble, carrying the itinerary', () => {
  const doc = dom(render(reportCta('i1')))

  assert.equal(attr(doc, 'a.file', 'href'), '/gita/nuova?itinerario=i1')
  assert.equal(attr(doc, 'a.file', 'aria-label'), 'Racconta la tua gita')
  assert.equal(doc.querySelectorAll('a.file svg').length, 1, 'the icon, not a line of text')
})

test('a different itinerary carries a different id, not a fixed one', () => {
  const doc = dom(render(reportCta('monviso-cresta-est')))
  assert.equal(attr(doc, 'a.file', 'href'), '/gita/nuova?itinerario=monviso-cresta-est')
})
