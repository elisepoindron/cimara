import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { favoriteButton } from '../../src/render/favorite-button.ts'

const dom = (m: string) => parseHTML(`<div>${m}</div>`).document
const attr = (doc: Document, s: string, n: string) => doc.querySelector(s)?.getAttribute(n) ?? null

test('signed out, the star is a plain link to sign in, next carried through', () => {
  const doc = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: false, next: '/itinerario/i1', viewer: null, csrf: 'tok',
  })))

  assert.equal(doc.querySelectorAll('form').length, 0, 'nobody signed in has a form to submit')
  assert.equal(attr(doc, 'a.fav', 'href'), '/accedi?next=%2Fitinerario%2Fi1')
})

test('no csrf token is the same as no viewer: still a link, not a form nobody can sign', () => {
  const doc = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: false, next: '/itinerario/i1',
    viewer: { id: 'a1', displayName: 'vale74' }, csrf: undefined,
  })))
  assert.equal(doc.querySelectorAll('form').length, 0)
})

test('signed in, not yet a favorite: a form that adds it', () => {
  const doc = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: false, next: '/itinerario/i1',
    viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok',
  })))

  assert.equal(attr(doc, 'form', 'action'), '/preferiti/i1')
  assert.equal(attr(doc, 'form', 'method'), 'post')
  assert.equal(attr(doc, 'form input[name=csrf]', 'value'), 'tok')
  assert.equal(attr(doc, 'form input[name=next]', 'value'), '/itinerario/i1')
  assert.equal(doc.querySelector('button.fav')!.className.includes('fav--on'), false)
})

test('signed in, already a favorite: a form that removes it, and the filled class', () => {
  const doc = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: true, next: '/itinerario/i1',
    viewer: { id: 'a1', displayName: 'vale74' }, csrf: 'tok',
  })))

  assert.equal(attr(doc, 'form', 'action'), '/preferiti/i1/rimuovi')
  assert.equal(doc.querySelector('button.fav--on') !== null, true)
})

test('the button always names itself for someone not reading the star', () => {
  const off = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: false, next: '/x',
    viewer: { id: 'a1', displayName: 'v' }, csrf: 'tok',
  })))
  const on = dom(render(favoriteButton({
    itineraryId: 'i1', isFavorite: true, next: '/x',
    viewer: { id: 'a1', displayName: 'v' }, csrf: 'tok',
  })))

  assert.equal(attr(off, 'button', 'aria-label'), 'Aggiungi ai preferiti')
  assert.equal(attr(on, 'button', 'aria-label'), 'Rimuovi dai preferiti')
})

test('on a phone the signed-in star’s form adds no margin below its tile', async () => {
  // Signed in, the star is a form and the other two actions are links. A form
  // keeps a bottom margin, which stretched the row and left the star's tile
  // shorter than Indicazioni and Scrivi beside it.
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../../public/app.css', import.meta.url), 'utf8')
  const rule = css.match(/\.phead \.ptitle>form\{([^}]*)\}/)
  assert.ok(rule, 'the phone head styles the star’s form')
  assert.match(rule[1]!, /margin:1\.1rem 0 0/)
})
