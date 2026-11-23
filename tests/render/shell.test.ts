import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { shell } from '../../src/render/shell.ts'
import { html } from '../../src/render/html.ts'

const dom = (m: string) => parseHTML(m).document

test('a page with no extraHead carries none', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>` }))
  assert.equal(doc.querySelectorAll('link[href="https://example.test/x.css"]').length, 0)
})

test('extraHead is rendered ahead of the body, for the one page that needs it', () => {
  const doc = dom(shell({
    title: 'Prova', body: html`<p>ok</p>`,
    extraHead: html`<link rel="stylesheet" href="https://example.test/x.css">`,
  }))
  assert.equal(doc.querySelectorAll('link[href="https://example.test/x.css"]').length, 1)
  assert.equal(doc.querySelector('p')!.textContent, 'ok', 'the body still renders')
})

test('every page asks a phone to lay it out at its own width, so the narrow-screen rules apply', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>` }))
  const metas = doc.querySelectorAll('meta[name="viewport"]')
  assert.equal(metas.length, 1)
  assert.equal(metas[0]!.getAttribute('content'), 'width=device-width,initial-scale=1')
})

test('every page leads to Info from the header, a plain link and no menu, before the way in', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>` }))
  const hrefs = [...doc.querySelectorAll('header nav a')].map(a => a.getAttribute('href'))
  assert.deepEqual(hrefs, ['/trova', '/preferiti', '/info', '/accedi'])
})

test('a phone has the same four places in a bar at the bottom, the page’s own one marked', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>`, tab: 'info' }))
  const places = [...doc.querySelectorAll('.tabbar a')]
  assert.deepEqual(places.map(a => a.getAttribute('href')), ['/trova', '/preferiti', '/info', '/accedi'])
  assert.deepEqual(places.filter(a => a.getAttribute('aria-current') === 'page').map(a => a.getAttribute('href')), ['/info'])
  assert.equal(doc.querySelectorAll('nav').length, 1, 'the bar is not a second nav, so the header nav styles never reach it')
})

test('signed in, the bar’s fourth place is the reader, holding the way out', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>`, viewer: { id: 'u1', displayName: 'Marta' }, csrf: 't' }))
  assert.equal(doc.querySelector('.tabbar__me summary')?.textContent?.trim(), 'Marta')
  assert.equal(doc.querySelector('.tabbar__me form')?.getAttribute('action'), '/esci')
  assert.equal(doc.querySelectorAll('.tabbar a[href="/accedi"]').length, 0)
})

test('there is no site footer: a page ends where its own body does', () => {
  const doc = dom(shell({ title: 'Prova', body: html`<p>ok</p>` }))
  assert.equal(doc.querySelectorAll('footer').length, 0)
})
