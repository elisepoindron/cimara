import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, post, tokenFrom, type RunningServer } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'
import { fileFromForm, retract } from '../../src/app/gite.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'

// Today, because the page tests below go through the server, which grades
// against the real clock: a report pinned to a date in 2026 would fall out of
// alpinismo's seven-day window and the control would vanish from the page.
const NOW = new Date()

/**
 * A day, counted back from today. The server grades against the real clock and
 * alpinismo's window is seven days, so a report dated by literal stops being
 * current a week after somebody typed it — and the test would go red on a
 * Tuesday for a reason nothing in the failure explains.
 */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)


/**
 * One route and one filed report, through the same path a climber takes. The
 * gita is filed by `fileFromForm` rather than inserted, so the observation that
 * goes with it exists too — which is the whole point of the reversal below.
 */
async function scene(): Promise<RunningServer & { gitaId: string }> {
  const s = await running()
  await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(s.db, { id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
             esposizione: 'SE', giorni: 1 },
    sections: {}, created: '2026-09-01T00:00:00.000Z' })

  const { cookie } = await signUpAs(s.base, 'vale@example.it', 'vale74')
  const filed = await fileFromForm(s.db, memoryPhotoStore(), memoryPhotoStore(), {
    itineraryId: 'i1', accountId: await accountIdOf(s, 'vale@example.it'),
    fields: new Map(Object.entries({
      quando: daysAgo(2), verdetto: 'buone', limite_neve: '3400',
      parole: 'Neve dura sopra i 3200.',
    })),
  }, NOW)
  assert.equal(filed.ok, true, 'the scene must start from a filed report')

  void cookie
  return { ...s, gitaId: filed.ok ? filed.gitaId : '' }
}

async function accountIdOf(s: RunningServer, email: string): Promise<string> {
  const row = await s.db.get<{ id: string }>('select id from account where email = ?', [email])
  return row!.id
}

interface Session { readonly token: string; readonly cookie: string }

async function signUpAs(base: string, email: string, nome: string): Promise<Session> {
  const { token, cookie } = await tokenFrom(base, '/registrati')
  const up = await post(base, '/registrati',
    { csrf: token, email, password: 'una password lunga', nome }, cookie)
  const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
  return { token, cookie: `${cookie}; ${session}` }
}

async function get(base: string, path: string, cookie = '') {
  const res = await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} })
  return { status: res.status, body: await res.text() }
}

const dom = (m: string) => parseHTML(m).document

// Never assert a DOM node against null — see the note in filing-routes.test.ts.
const attr = (doc: Document, selector: string, name: string) =>
  doc.querySelector(selector)?.getAttribute(name) ?? null

test('the author withdraws, and the report stops speaking', async () => {
  const s = await scene()
  try {
    const r = await retract(s.db, s.gitaId, await accountIdOf(s, 'vale@example.it'), NOW)

    assert.equal(r.ok, true)
    assert.equal((await giteFor(s.db, 'i1')).length, 0)
  } finally { s.server.close() }
})

test('the gita stays on disk — withdrawing hides, it never deletes', async () => {
  const s = await scene()
  try {
    await retract(s.db, s.gitaId, await accountIdOf(s, 'vale@example.it'), NOW)

    assert.equal((await s.db.all('select id from gita')).length, 1,
      'withdrawing adds a retraction; you cannot get back what was destroyed')
  } finally { s.server.close() }
})

test('somebody else cannot withdraw it, and it survives', async () => {
  const s = await scene()
  try {
    await signUpAs(s.base, 'ste@example.it', 'ste')
    const r = await retract(s.db, s.gitaId, await accountIdOf(s, 'ste@example.it'), NOW)

    assert.equal(r.ok, false)
    assert.equal((await giteFor(s.db, 'i1')).length, 1, 'it is not theirs to withdraw')
  } finally { s.server.close() }
})

test('withdrawing twice is not an error, and leaves one row', async () => {
  const s = await scene()
  try {
    const me = await accountIdOf(s, 'vale@example.it')
    const first = await retract(s.db, s.gitaId, me, NOW)
    const again = await retract(s.db, s.gitaId, me, new Date(NOW.getTime() + 86_400_000))

    assert.equal(first.ok, true)
    assert.equal(again.ok, true, 'a double-clicked button is not a 500')

    const rows = await s.db.all<{ retracted_at: string }>('select retracted_at from retraction')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.retracted_at, NOW.toISOString(),
      'the second attempt writes nothing, so the first withdrawal keeps its date')
  } finally { s.server.close() }
})

test('withdrawing a report that does not exist is refused, not ignored', async () => {
  const s = await scene()
  try {
    const r = await retract(s.db, 'non-esiste', await accountIdOf(s, 'vale@example.it'), NOW)
    assert.equal(r.ok, false)
  } finally { s.server.close() }
})

test('through the server: the author withdraws and lands back on the route', async () => {
  const s = await scene()
  try {
    const { cookie } = await signUpAs(s.base, 'vale2@example.it', 'vale-again')
    void cookie
    const mine = await tokenFromSignedIn(s.base, 'vale@example.it')
    const r = await post(s.base, `/gita/${s.gitaId}/ritira`, { csrf: mine.token }, mine.cookie)

    assert.equal(r.status, 303)
    assert.equal(r.location, '/itinerario/i1')
    assert.equal((await giteFor(s.db, 'i1')).length, 0)
  } finally { s.server.close() }
})

test('through the server: a stranger is refused with 403 and the report survives', async () => {
  const s = await scene()
  try {
    const them = await signUpAs(s.base, 'ste@example.it', 'ste')
    const r = await post(s.base, `/gita/${s.gitaId}/ritira`, { csrf: them.token }, them.cookie)

    assert.equal(r.status, 403)
    assert.equal((await giteFor(s.db, 'i1')).length, 1)
  } finally { s.server.close() }
})

test('through the server: signed out is refused, and the report survives', async () => {
  const s = await scene()
  try {
    const { token, cookie } = await tokenFrom(s.base, '/accedi')
    const r = await post(s.base, `/gita/${s.gitaId}/ritira`, { csrf: token }, cookie)

    assert.equal(r.status, 403)
    assert.equal((await giteFor(s.db, 'i1')).length, 1)
  } finally { s.server.close() }
})

test('through the server: a bad token is refused, and the report survives', async () => {
  const s = await scene()
  try {
    const mine = await tokenFromSignedIn(s.base, 'vale@example.it')
    const r = await post(s.base, `/gita/${s.gitaId}/ritira`,
      { csrf: 'un-valore-inventato' }, mine.cookie)

    assert.equal(r.status, 403)
    assert.equal((await giteFor(s.db, 'i1')).length, 1)
  } finally { s.server.close() }
})

test('the control is on the reports page for the author, and posts to withdraw', async () => {
  const s = await scene()
  try {
    const mine = await tokenFromSignedIn(s.base, 'vale@example.it')
    const page = await get(s.base, '/itinerario/i1/relazioni', mine.cookie)
    const doc = dom(page.body)

    assert.equal(attr(doc, 'form.ritira', 'action'), `/gita/${s.gitaId}/ritira`)
    assert.equal(attr(doc, 'form.ritira', 'method'), 'post')
    assert.equal(attr(doc, 'form.ritira input[name=csrf]', 'value'), mine.token,
      'the control carries a token, or the route it posts to would refuse it')
  } finally { s.server.close() }
})

test('the control is not on the reports page for a stranger, nor for a signed-out reader', async () => {
  const s = await scene()
  try {
    const them = await signUpAs(s.base, 'ste@example.it', 'ste')
    const strangers = dom((await get(s.base, '/itinerario/i1/relazioni', them.cookie)).body)
    assert.equal(strangers.querySelectorAll('form.ritira').length, 0,
      'hiding it is presentation; the route is the control — but it must still be hidden')

    const anon = dom((await get(s.base, '/itinerario/i1/relazioni')).body)
    assert.equal(anon.querySelectorAll('form.ritira').length, 0)
    assert.equal(anon.querySelectorAll('.slip__words').length, 1,
      'the report itself is still there to read: only the way to withdraw it is gone')
  } finally { s.server.close() }
})

/** Signs in as somebody who already has an account, and returns a fresh token. */
async function tokenFromSignedIn(base: string, email: string): Promise<Session> {
  const { token, cookie } = await tokenFrom(base, '/accedi')
  const inRes = await post(base, '/accedi',
    { csrf: token, email, password: 'una password lunga' }, cookie)
  const session = inRes.cookies.find(c => c.startsWith('session='))!.split(';')[0]
  const full = `${cookie}; ${session}`
  // The token is bound to the csrf cookie, not to the session, so the one
  // fetched above is still the right one to send back.
  return { token, cookie: full }
}
