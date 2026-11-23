import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { signUpPage, signInPage } from '../../src/render/account.ts'

const dom = (m: string) => parseHTML(m).document

test('the sign-up form carries the token, and posts to itself', () => {
  const doc = dom(signUpPage({ csrf: 'token-abc' }))
  const form = doc.querySelector('form')!

  assert.equal(form.getAttribute('method')?.toLowerCase(), 'post')
  assert.equal(form.getAttribute('action'), '/registrati')
  assert.equal(doc.querySelector('input[name=csrf]')?.getAttribute('value'), 'token-abc')
  for (const field of ['email', 'password', 'nome']) {
    assert.ok(doc.querySelector(`[name=${field}]`), `no ${field} field`)
  }
})

test('a failed attempt keeps what was typed, except the password', () => {
  const doc = dom(signUpPage({
    csrf: 't', problems: ['Indirizzo non valido.'],
    email: 'sbagliato', displayName: 'elise',
  }))

  assert.equal(doc.querySelector('[name=email]')?.getAttribute('value'), 'sbagliato')
  assert.equal(doc.querySelector('[name=nome]')?.getAttribute('value'), 'elise')
  assert.equal(doc.querySelector('[name=password]')?.getAttribute('value'), null,
    'a password must never be echoed back into the page')
  // doc.body.textContent, not documentElement, is what the brief asks — but this
  // project's pages open `<html lang="it">` with no `<head>`/`<body>` (CLAUDE.md:
  // "Keep this", followed by every file under src/render/), and linkedom 0.18's
  // parser never migrates content into an implicit <body> when one is never
  // written: it stays a permanently empty sibling, so doc.body.textContent is ''
  // for every page this project renders, itinerary-page.ts included. Confirmed
  // with a minimal repro before changing this line. documentElement carries the
  // same intent — the message is visible text on the page — without requiring
  // a <body> tag this file's own neighbour (test 5, below) already knows not to
  // assume.
  assert.match(doc.documentElement.textContent!, /Indirizzo non valido\./)
})

test('a problem containing markup arrives as text', () => {
  const doc = dom(signUpPage({ csrf: 't', problems: ['<script>alert(1)</script>'] }))
  assert.equal(doc.querySelectorAll('script:not([src="/page-motion.js"]):not([src="/ground-motion.js"]):not([src="/grade-nine.js"]):not([src="/password-peek.js"])').length, 0,
    'only the shell’s own two motion scripts and the password toggle')
})

test('the sign-in page carries where you were going', () => {
  const doc = dom(signInPage({ csrf: 't', next: '/gita/nuova?itinerario=abc' }))
  assert.equal(doc.querySelector('[name=next]')?.getAttribute('value'), '/gita/nuova?itinerario=abc')
})

test('the sign-in page offers a way to the sign-up page', () => {
  const doc = dom(signInPage({ csrf: 't' }))
  const alt = doc.querySelector('.alt')
  const link = alt?.querySelector('a[href="/registrati"]')
  assert.equal(link?.textContent, 'Registrati')
  assert.equal(link?.getAttribute('class'), 'btn')
  assert.match(alt?.textContent ?? '', /Non hai un account\?/)
})

test('both pages are Italian', () => {
  for (const page of [signUpPage({ csrf: 't' }), signInPage({ csrf: 't' })]) {
    assert.equal(dom(page).documentElement.getAttribute('lang'), 'it')
  }
})

test('the sign-up form asks for the name first, the name that signs every relazione', () => {
  const doc = dom(signUpPage({ csrf: 't' }))
  const names = [...doc.querySelectorAll('form input:not([type=hidden])')].map(i => i.getAttribute('name'))
  assert.deepEqual(names, ['nome', 'email', 'password'])
})

test('both pages are one card with a rail, and each rail leads to the other page', () => {
  for (const [page, other] of [[signUpPage({ csrf: 't' }), '/accedi'], [signInPage({ csrf: 't' }), '/registrati']] as const) {
    const doc = dom(page)
    assert.equal(doc.querySelectorAll('main.acc .acc__form form').length, 1)
    assert.equal(doc.querySelectorAll(`.acc__rail .alt a.btn[href="${other}"]`).length, 1)
  }
})

test('the password field leaves room for its toggle, and the page loads it', () => {
  const doc = dom(signUpPage({ csrf: 't' }))
  assert.equal(doc.querySelectorAll('.pw > input[name=password]').length, 1)
  assert.equal(doc.querySelectorAll('script[src^="/password-peek.js"]').length, 1)
  assert.equal(doc.querySelector('[name=password]')?.getAttribute('autocomplete'), 'new-password')
})
