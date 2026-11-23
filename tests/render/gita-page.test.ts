import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { gitaPage } from '../../src/render/gita-page.ts'
import { activityOf } from '../../src/domain/activities/index.ts'

const dom = (m: string) => parseHTML(m).document

const base = { schema: activityOf('falesia'), itineraryId: 'i1', itineraryName: 'Roaschia',
               csrf: 't', today: '2026-11-16', photos: [] }

test('the sheet is signed with the viewer’s own name', () => {
  const doc = dom(gitaPage({ ...base, viewer: { id: 'a1', displayName: 'vale74' } }))
  assert.match(doc.querySelector('.sheet__ft')?.textContent ?? '', /Firmata vale74/)
})

test('the page loads the count script, and the line above the title leads back to the route', () => {
  const doc = dom(gitaPage(base))
  assert.equal(doc.querySelectorAll('script[src^="/words-count.js"]').length, 1)
  assert.equal(doc.querySelector('.sheet-head .crumb a')?.getAttribute('href'), '/itinerario/i1')
  assert.equal(doc.querySelector('h1')?.textContent, 'Roaschia')
})
