import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, post, tokenFrom, type RunningServer } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { isFavorite } from '../../src/db/favorite.ts'

async function scene(): Promise<RunningServer> {
  const s = await running()
  await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(s.db, { id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
             esposizione: 'SE', giorni: 1 },
    sections: {}, created: '2026-09-01T00:00:00.000Z' })
  return s
}

interface Session { readonly token: string; readonly cookie: string }

async function signedIn(base: string): Promise<Session> {
  const { token, cookie } = await tokenFrom(base, '/registrati')
  const up = await post(base, '/registrati', {
    csrf: token, email: 'vale@example.it', password: 'una password lunga', nome: 'vale74',
  }, cookie)
  const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
  return { token, cookie: `${cookie}; ${session}` }
}

async function accountIdOf(s: RunningServer, email: string): Promise<string> {
  const row = await s.db.get<{ id: string }>('select id from account where email = ?', [email])
  return row!.id
}

async function get(base: string, path: string, cookie = '') {
  const res = await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} })
  return { status: res.status, body: await res.text(), location: res.headers.get('location') }
}

const dom = (m: string) => parseHTML(m).document
const attr = (doc: Document, s: string, n: string) => doc.querySelector(s)?.getAttribute(n) ?? null

test('the itinerary page offers a way to favorite it, whoever is reading', async () => {
  const s = await scene()
  try {
    const anon = dom((await get(s.base, '/itinerario/i1')).body)
    assert.equal(attr(anon, '.ptitle a.fav', 'href'), '/accedi?next=%2Fitinerario%2Fi1')
  } finally { s.server.close() }
})

test('signed in, favoriting from the page adds it and lands back on it', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    const r = await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    assert.equal(r.status, 303)
    assert.equal(r.location, '/itinerario/i1')
    assert.equal(await isFavorite(s.db, await accountIdOf(s, 'vale@example.it'), 'i1'), true)
  } finally { s.server.close() }
})

test('the page then shows the filled star and the remove action', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    const doc = dom((await get(s.base, '/itinerario/i1', cookie)).body)
    assert.equal(doc.querySelector('.ptitle button.fav--on') !== null, true)
    assert.equal(attr(doc, '.ptitle form', 'action'), '/preferiti/i1/rimuovi')
  } finally { s.server.close() }
})

test('removing it sends the star back to outline', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    const r = await post(s.base, '/preferiti/i1/rimuovi', { csrf: token, next: '/itinerario/i1' }, cookie)
    assert.equal(r.status, 303)
    assert.equal(await isFavorite(s.db, await accountIdOf(s, 'vale@example.it'), 'i1'), false)
  } finally { s.server.close() }
})

test('favoriting twice through the server writes one row', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    const rows = await s.db.all('select * from favorite')
    assert.equal(rows.length, 1)
  } finally { s.server.close() }
})

test('signed out, posting to favorite is refused and writes nothing', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await tokenFrom(s.base, '/accedi')
    const r = await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    assert.equal(r.status, 403)
    assert.equal((await s.db.all('select * from favorite')).length, 0)
  } finally { s.server.close() }
})

test('favoriting an itinerary that does not exist is a 404', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    const r = await post(s.base, '/preferiti/non-esiste', { csrf: token, next: '/' }, cookie)
    assert.equal(r.status, 404)
  } finally { s.server.close() }
})

test('a bad csrf token is refused, and nothing is written', async () => {
  const s = await scene()
  try {
    const { cookie } = await signedIn(s.base)
    const r = await post(s.base, '/preferiti/i1', { csrf: 'un-valore-inventato', next: '/itinerario/i1' }, cookie)

    assert.equal(r.status, 403)
    assert.equal((await s.db.all('select * from favorite')).length, 0)
  } finally { s.server.close() }
})

test('a Find result row carries the star and posts back to the same search', async () => {
  const s = await scene()
  try {
    const { cookie } = await signedIn(s.base)
    const doc = dom((await get(s.base, '/trova?q=Prova', cookie)).body)

    assert.equal(doc.querySelector('.r button.fav') !== null, true)
    assert.equal(attr(doc, '.r form', 'action'), '/preferiti/i1')
    assert.equal(attr(doc, '.r form input[name=next]', 'value'), '/trova?q=Prova')
  } finally { s.server.close() }
})

test('once favorited, the same search shows the row already starred', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/trova?q=Prova' }, cookie)

    const doc = dom((await get(s.base, '/trova?q=Prova', cookie)).body)
    assert.equal(doc.querySelector('.r button.fav--on') !== null, true)
  } finally { s.server.close() }
})

test('signed out, /preferiti sends you to sign in and remembers where you were', async () => {
  const s = await scene()
  try {
    const r = await get(s.base, '/preferiti')

    assert.equal(r.status, 303)
    assert.equal(r.location, '/accedi?next=%2Fpreferiti')
  } finally { s.server.close() }
})

test('signed in, /preferiti lists what was starred', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    const doc = dom((await get(s.base, '/preferiti', cookie)).body)
    assert.equal(doc.querySelector('a.r__link')?.textContent, 'Prova')
  } finally { s.server.close() }
})

test('unfavoriting from the list itself sends you back to the list', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await signedIn(s.base)
    await post(s.base, '/preferiti/i1', { csrf: token, next: '/itinerario/i1' }, cookie)

    const listed = dom((await get(s.base, '/preferiti', cookie)).body)
    const removeToken = attr(listed, 'form input[name=csrf]', 'value')!

    const r = await post(s.base, '/preferiti/i1/rimuovi', { csrf: removeToken, next: '/preferiti' }, cookie)
    assert.equal(r.status, 303)
    assert.equal(r.location, '/preferiti')

    const after = dom((await get(s.base, '/preferiti', cookie)).body)
    // documentElement, not body: see tests/render/account.test.ts for the
    // confirmed repro — this project's pages open `<html lang="it">` with no
    // `<head>`/`<body>`, so linkedom never migrates content into an implicit <body>.
    assert.match(after.documentElement.textContent!, /Nessun preferito ancora/)
  } finally { s.server.close() }
})
