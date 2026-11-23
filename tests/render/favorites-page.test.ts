import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { favoritesPage } from '../../src/render/favorites-page.ts'
import type { FavoriteRow } from '../../src/app/favorites.ts'

const dom = (m: string) => parseHTML(m).document
const attr = (doc: Document, s: string, n: string) => doc.querySelector(s)?.getAttribute(n) ?? null

const ROW: FavoriteRow = {
  id: 'i1', name: 'Monviso, Cresta Est', where: 'CN Crissolo',
  cells: [
    { kind: 'fact', icon: 'grado', label: 'Difficoltà', text: 'AD', aspect: null },
    { kind: 'fact', icon: 'dplus', label: 'Dislivello', text: '2000 m', aspect: null },
    { kind: 'fact', icon: 'esp', label: 'Esposizione', text: 'Sud-Est', aspect: 'SE' },
    null,
  ],
}

test('every favorited row is shown, already starred, posting to remove it', () => {
  const doc = dom(favoritesPage({
    rows: [ROW], viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok',
  }))

  assert.equal(doc.querySelector('a.r__link')?.textContent, 'Monviso, Cresta Est')
  assert.equal(doc.querySelector('.r__n small')?.textContent, 'CN Crissolo')
  assert.equal(doc.querySelectorAll('.r__f > div').length, 3, 'unaligned: the empty distance slot is left out')
  assert.equal(doc.querySelectorAll('svg.icons').length, 1)
  assert.equal(attr(doc, '.list', 'class'), 'list', 'Preferiti mixes activities, so nothing lines up across rows')
  assert.equal(doc.querySelector('button.fav--on') !== null, true)
  assert.equal(attr(doc, '.r form', 'action'), '/preferiti/i1/rimuovi')
  assert.equal(attr(doc, '.r form input[name=next]', 'value'), '/preferiti')
  assert.equal(attr(doc, 'a.r__link', 'href'), '/itinerario/i1')
})

test('an empty list says so, and points back to Trova', () => {
  const doc = dom(favoritesPage({ rows: [], viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok' }))

  assert.equal(doc.querySelectorAll('.r').length, 0)
  // documentElement, not body: this project's pages open `<html lang="it">` with
  // no `<head>`/`<body>`, so linkedom never migrates content into an implicit
  // <body> — see tests/render/account.test.ts for the confirmed repro.
  assert.match(doc.documentElement.textContent!, /Nessun preferito ancora/)
  // Scoped to `.empty`, the empty state's own paragraph. A bare
  // `a[href="/trova"]` matches the nav link shell() puts on every page, so it
  // would pass with the way out of the empty state deleted outright.
  assert.equal(doc.querySelector('.empty a[href="/trova"]')?.textContent, 'Torna a Trova')
})

test('the page names itself, in the tab title and the heading', () => {
  const doc = dom(favoritesPage({ rows: [], viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok' }))

  assert.match(doc.querySelector('title')!.textContent!, /Preferiti/)
  assert.equal(doc.querySelector('.phead h1')?.textContent, 'Preferiti')
})
