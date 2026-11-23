import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, post, tokenFrom, type RunningServer } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'

/**
 * One alpine route in the running server's own database, invented like every
 * other route in this project. Its facts are complete because `/itinerario/i1`
 * is one of the pages asserted on below, and a page resolves its facts against
 * the registry before it renders. The account comes from signing up through the
 * server, so the session is a real one.
 */
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

/** Signs up, and returns the CSRF token plus every cookie to send back. */
async function signedIn(base: string): Promise<Session> {
  const { token, cookie } = await tokenFrom(base, '/registrati')
  const up = await post(base, '/registrati', {
    csrf: token, email: 'vale@example.it', password: 'una password lunga', nome: 'vale74',
  }, cookie)
  const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
  return { token, cookie: `${cookie}; ${session}` }
}

interface GetResult { readonly status: number; readonly body: string; readonly location: string | null }

async function get(base: string, path: string, cookie = ''): Promise<GetResult> {
  const res = await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} })
  return { status: res.status, body: await res.text(), location: res.headers.get('location') }
}


/**
 * A day, counted back from today. The server grades against the real clock and
 * alpinismo's window is seven days, so a report dated by literal stops being
 * current a week after somebody typed it — and the test would go red on a
 * Tuesday for a reason nothing in the failure explains.
 */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const GOOD = {
  itinerario: 'i1', quando: daysAgo(2), verdetto: 'buone',
  limite_neve: '3400', parole: 'Neve dura sopra i 3200.',
}

// Never assert a DOM node against null: `assert` formats a failure with
// `depth: 1000, getters: true`, and a linkedom node unfolds the whole document
// through its getters — the run hangs and is killed with no message. Every
// assertion below names an attribute or a count instead.
const attr = (doc: Document, selector: string, name: string) =>
  doc.querySelector(selector)?.getAttribute(name) ?? null

test('signed out, the composer sends you to sign in and remembers where you were', async () => {
  const { server, base } = await scene()
  try {
    const r = await get(base, '/gita/nuova?itinerario=i1')

    assert.equal(r.status, 303)
    assert.equal(r.location?.startsWith('/accedi?next='), true, `got ${r.location}`)
    const next = new URL(r.location!, 'http://x.invalid').searchParams.get('next')
    assert.equal(next, '/gita/nuova?itinerario=i1')
  } finally { server.close() }
})

test('signed in, the composer is a page, and it asks for the day and the words', async () => {
  const { server, base } = await scene()
  try {
    const { cookie } = await signedIn(base)
    const r = await get(base, '/gita/nuova?itinerario=i1&foto=', cookie)

    assert.equal(r.status, 200)
    assert.match(r.body, /<html lang="it">/)
    assert.match(r.body, /\/app\.css/)
    assert.match(r.body, /name="parole"/)
    assert.doesNotMatch(r.body, /name="verdetto"|name="limite_neve"/)
  } finally { server.close() }
})

test('the composer for an itinerary that does not exist is a 404', async () => {
  const { server, base } = await scene()
  try {
    const { cookie } = await signedIn(base)
    assert.equal((await get(base, '/gita/nuova?itinerario=non-esiste', cookie)).status, 404)
  } finally { server.close() }
})

test('a good submission files the gita and sends you back to the route', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    const r = await post(base, '/gita', { csrf: token, ...GOOD }, cookie)

    assert.equal(r.status, 303)
    assert.equal(r.location, '/itinerario/i1')
    assert.equal((await giteFor(db, 'i1')).length, 1)
  } finally { server.close() }
})

test('a refused submission comes back with the problem and the paragraph still in it', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    const r = await post(base, '/gita',
      { csrf: token, ...GOOD, quando: '2099-01-01' }, cookie)

    assert.equal(r.status, 200)
    assert.match(r.body, /nel futuro/)
    assert.match(r.body, /Neve dura sopra i 3200\./, 'nobody loses their paragraph')
    assert.equal((await giteFor(db, 'i1')).length, 0)
  } finally { server.close() }
})

test('signed out, posting a gita is refused and files nothing', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/accedi')
    const r = await post(base, '/gita', { csrf: token, ...GOOD }, cookie)

    assert.equal(r.status, 403)
    assert.equal((await giteFor(db, 'i1')).length, 0)
  } finally { server.close() }
})

test('a post with someone else’s token is refused, and files nothing', async () => {
  const { server, base, db } = await scene()
  try {
    const { cookie } = await signedIn(base)
    const r = await post(base, '/gita', { csrf: 'un-valore-inventato', ...GOOD }, cookie)

    assert.equal(r.status, 403)
    assert.equal((await giteFor(db, 'i1')).length, 0)
  } finally { server.close() }
})

// Ruling F: the nav hard-coded "Accedi" on every page and read nobody, so
// sign-out was unreachable from anywhere in the application. These go through
// the itinerary page, because that is the page a reader is actually on.
test('signed in, a page offers a way out, and it is a form that posts', async () => {
  const { server, base } = await scene()
  try {
    const { cookie } = await signedIn(base)
    const doc = parseHTML((await get(base, '/itinerario/i1', cookie)).body).document

    assert.equal(attr(doc, 'nav form', 'action'), '/esci')
    assert.equal(attr(doc, 'nav form', 'method')?.toLowerCase(), 'post',
      'signing out changes state: a link would let any page do it for you')
    assert.equal((attr(doc, 'nav form [name=csrf]', 'value') ?? '').length > 0, true)
    assert.match(doc.querySelector('nav')!.textContent!, /vale74/, 'and it says who you are')
  } finally { server.close() }
})

test('signed out, the same page offers a way in and no way out', async () => {
  const { server, base } = await scene()
  try {
    const doc = parseHTML((await get(base, '/itinerario/i1')).body).document

    assert.equal(doc.querySelectorAll('nav form').length, 0)
    assert.equal([...doc.querySelectorAll('nav a')].some(a => a.getAttribute('href') === '/accedi'),
      true, 'the sign-in link was href="#" on this page')
  } finally { server.close() }
})

test('after filing, the route page links to reading the relazione back', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    await post(base, '/gita', { csrf: token, ...GOOD }, cookie)

    const doc = parseHTML((await get(base, '/itinerario/i1', cookie)).body).document
    assert.equal(attr(doc, '#relazioni a.sum__go', 'href'), '/itinerario/i1/relazioni')
    assert.equal(doc.querySelector('#relazioni a.sum__go')?.textContent, 'Leggi la relazione')
  } finally { server.close() }
})

test('the relazioni page reads back the words and the author, and no verdict', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    await post(base, '/gita', { csrf: token, ...GOOD }, cookie)

    const r = await get(base, '/itinerario/i1/relazioni')
    assert.equal(r.status, 200)
    assert.match(r.body, /Neve dura sopra i 3200\./)
    assert.match(r.body, /vale74/)
    assert.doesNotMatch(r.body, /Buone/)
  } finally { server.close() }
})

test('the relazioni page for an itinerary that does not exist is a 404', async () => {
  const { server, base } = await scene()
  try {
    assert.equal((await get(base, '/itinerario/non-esiste/relazioni')).status, 404)
  } finally { server.close() }
})

/** A real multipart/form-data POST, built with the platform's own FormData —
 * exercising the hand-rolled server-side parser against a standards encoder.
 * Defaults to `/gita` — the route the anonymous-body-size test below still
 * targets — but a caller reaching for the route that actually reads files
 * now, `/gita/foto`, names it explicitly. */
async function postPhoto(
  base: string, fields: Record<string, string>,
  photo: { field: string; name: string; type: string; bytes: Uint8Array<ArrayBuffer> },
  cookie: string, path = '/gita',
): Promise<{ status: number; body: string; location: string | null }> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append(photo.field, new Blob([photo.bytes], { type: photo.type }), photo.name)

  const res = await fetch(base + path, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form })
  return { status: res.status, body: await res.text(), location: res.headers.get('location') }
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])

/** The real two-step flow a browser takes: upload the photo to the pending
 * store, then publish naming its id — the six-slot, one-step `/gita`
 * multipart attachment this test used to exercise no longer exists. */
async function uploadThenPublish(
  base: string, token: string, cookie: string,
  photo: { field: string; name: string; type: string; bytes: Uint8Array<ArrayBuffer> },
) {
  const form = new FormData()
  form.append('csrf', token); form.append('itinerario', 'i1')
  form.append(photo.field, new Blob([photo.bytes], { type: photo.type }), photo.name)
  const uploaded = await fetch(base + '/gita/foto', {
    method: 'POST', redirect: 'manual', headers: { cookie }, body: form,
  })
  const id = new URL(uploaded.headers.get('location')!, base).searchParams.get('foto')!

  return post(base, '/gita', { csrf: token, ...GOOD, foto_ids: id, [`incl_${id}`]: 'on' }, cookie)
}

test('a gita filed with a real photo attachment succeeds end to end', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    const r = await uploadThenPublish(base, token, cookie,
      { field: 'foto', name: 'a.jpg', type: 'image/jpeg', bytes: JPEG_BYTES })

    assert.equal(r.status, 303)
    assert.equal(r.location, '/itinerario/i1')
    const rows = await db.all('select id from gita_photo')
    assert.equal(rows.length, 1)
  } finally { server.close() }
})

test('a multipart body over the cap is refused with 413, not read', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/accedi')
    // Bigger than MAX_BODY_BYTES (262_144) but well under MAX_PHOTO_BODY_BYTES
    // (50_000_000). /gita takes one cap for everyone now, signed in or not —
    // readFormBody enforces it before the body is even parsed, let alone
    // before an account is checked, so this is refused as too large rather
    // than read and then rejected for some other reason.
    const big = new Uint8Array(300_000)
    big.set([0xff, 0xd8, 0xff], 0)
    const r = await postPhoto(base, { csrf: token, ...GOOD },
      { field: 'foto_1', name: 'big.jpg', type: 'image/jpeg', bytes: big }, cookie)

    assert.equal(r.status, 413)
    assert.equal((await giteFor(db, 'i1')).length, 0)
  } finally { server.close() }
})

// Sniffing now happens once, at upload — publishing never reads raw bytes, so
// bad bytes can only ever be refused at POST /gita/foto, not at POST /gita.
test('a photo that is not really a JPEG or PNG is refused at upload, not at publish', async () => {
  const { server, base, db } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    const r = await postPhoto(base, { csrf: token, itinerario: 'i1' },
      { field: 'foto', name: 'a.jpg', type: 'image/jpeg', bytes: new TextEncoder().encode('non è un jpeg') },
      cookie, '/gita/foto')

    assert.equal(r.status, 200)
    assert.match(r.body, /solo JPEG o PNG/)
    assert.equal((await db.all('select id from pending_photo')).length, 0)
  } finally { server.close() }
})
