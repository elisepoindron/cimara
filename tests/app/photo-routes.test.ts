import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { running, post, tokenFrom } from '../helpers/http.ts'
import { freshDb } from '../helpers/db.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { createServer } from '../../src/app/server.ts'
import { filesystemPhotoStore } from '../../src/app/photo-store.ts'

async function scene() {
  const s = await running()
  await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(s.db, { id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000, esposizione: 'SE', giorni: 1 },
    sections: {}, created: '2026-09-01T00:00:00.000Z' })
  return s
}

interface FiledPhoto { readonly cookie: string; readonly token: string }

/** Signs up, uploads one photo, files a gita naming and including it, and
 * returns the session to act as its author again — retracting it, for
 * instance. The real two-step flow: upload, then publish naming what to
 * promote — the same two requests a browser would make. */
async function fileAPhoto(base: string): Promise<FiledPhoto> {
  const { token, cookie } = await tokenFrom(base, '/registrati')
  const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
  const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
  const signedIn = `${cookie}; ${session}`

  const form = new FormData()
  form.append('csrf', token); form.append('itinerario', 'i1')
  form.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }), 'a.jpg')
  const uploaded = await fetch(base + '/gita/foto', {
    method: 'POST', redirect: 'manual', headers: { cookie: signedIn }, body: form,
  })
  const id = new URL(uploaded.headers.get('location')!, base).searchParams.get('foto')!

  const res = await post(base, '/gita', {
    csrf: token, itinerario: 'i1',
    quando: new Date().toISOString().slice(0, 10), verdetto: 'buone', parole: 'Neve dura.',
    foto_ids: id, [`incl_${id}`]: 'on',
  }, signedIn)
  assert.equal(res.status, 303, 'the filing itself must succeed for every test that builds on this helper')

  return { cookie: signedIn, token }
}

test('a filed photo is servable at /foto/:id.jpg', async () => {
  const { server, base, db } = await scene()
  try {
    await fileAPhoto(base)
    const row = await db.get<{ id: string }>('select id from gita_photo')

    const res = await fetch(`${base}/foto/${row!.id}.jpg`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xd8, 0xff, 1, 2, 3])
  } finally { server.close() }
})

test('a photo id nobody filed is a 404', async () => {
  const { server, base } = await scene()
  try {
    const res = await fetch(`${base}/foto/non-esiste.jpg`)
    assert.equal(res.status, 404)
  } finally { server.close() }
})

test('asking for the wrong extension for a real photo is a 404, not the other file', async () => {
  const { server, base, db } = await scene()
  try {
    await fileAPhoto(base)
    const row = await db.get<{ id: string }>('select id from gita_photo')

    const res = await fetch(`${base}/foto/${row!.id}.png`)
    assert.equal(res.status, 404, 'the bytes were stored under .jpg; nothing wrote a .png for this id')
  } finally { server.close() }
})

test('the gallery page lists every photo filed against the route', async () => {
  const { server, base } = await scene()
  try {
    await fileAPhoto(base)
    const res = await fetch(`${base}/itinerario/i1/foto`)
    const body = await res.text()

    assert.equal(res.status, 200)
    assert.match(body, /<img src="\/foto\//)
  } finally { server.close() }
})

test('the gallery page for an itinerary that does not exist is a 404', async () => {
  const { server, base } = await scene()
  try {
    assert.equal((await fetch(`${base}/itinerario/non-esiste/foto`)).status, 404)
  } finally { server.close() }
})

test('the gallery\'s keyboard script is served as one', async () => {
  const { server, base } = await scene()
  try {
    const res = await fetch(`${base}/gallery-lightbox.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /javascript/)
  } finally { server.close() }
})

test('the mosaics\' viewer script is served as one', async () => {
  const { server, base } = await scene()
  try {
    const res = await fetch(`${base}/photo-zoom.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /javascript/)
  } finally { server.close() }
})

test('a photo stops being servable once the gita it belongs to is retracted', async () => {
  const { server, base, db } = await scene()
  try {
    const { cookie, token } = await fileAPhoto(base)
    const row = await db.get<{ id: string }>('select id from gita_photo')
    const gita = await db.get<{ id: string }>('select id from gita')

    const before = await fetch(`${base}/foto/${row!.id}.jpg`)
    assert.equal(before.status, 200, 'standing, before retraction')

    const ritira = await post(base, `/gita/${gita!.id}/ritira`, { csrf: token }, cookie)
    assert.equal(ritira.status, 303, 'the retraction itself must succeed')

    const after = await fetch(`${base}/foto/${row!.id}.jpg`)
    assert.equal(after.status, 404,
      'retraction is the only way a photo stops showing — including the raw bytes at this URL')
  } finally { server.close() }
})

test('the rail’s photo on the itinerary page leads into the gallery, at that photo', async () => {
  const { server, base } = await scene()
  try {
    await fileAPhoto(base)
    const body = await (await fetch(`${base}/itinerario/i1`)).text()
    // One photo: no +N tile, so no bare gallery link; the tile opens the gallery at its viewer.
    assert.match(body, /href="\/itinerario\/i1\/foto#lb-/)
  } finally { server.close() }
})

test('POST /gita/foto is refused for a signed-out visitor, before any file is read', async () => {
  const { server, base } = await scene()
  try {
    const form = new FormData()
    form.append('csrf', 'whatever'); form.append('itinerario', 'i1')
    form.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'a.jpg')
    const res = await fetch(base + '/gita/foto', { method: 'POST', body: form })
    assert.equal(res.status, 403)
  } finally { server.close() }
})

test('POST /gita/foto uploads, and redirects to screen 2 naming the ids', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const form = new FormData()
    form.append('csrf', token); form.append('itinerario', 'i1')
    form.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }), 'a.jpg')
    const res = await fetch(base + '/gita/foto', {
      method: 'POST', redirect: 'manual', headers: { cookie: signedIn }, body: form,
    })

    assert.equal(res.status, 303)
    const location = res.headers.get('location')!
    assert.match(location, /^\/gita\/nuova\?itinerario=i1&foto=[\w-]+$/)
  } finally { server.close() }
})

test('a pending photo is servable at /foto/pending/:id.:ext, scoped to the account that uploaded it', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const form = new FormData()
    form.append('csrf', token); form.append('itinerario', 'i1')
    form.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }), 'a.jpg')
    const uploaded = await fetch(base + '/gita/foto', {
      method: 'POST', redirect: 'manual', headers: { cookie: signedIn }, body: form,
    })
    const id = new URL(uploaded.headers.get('location')!, base).searchParams.get('foto')!

    const asUploader = await fetch(`${base}/foto/pending/${id}.jpg`, { headers: { cookie: signedIn } })
    assert.equal(asUploader.status, 200)
    assert.equal(asUploader.headers.get('content-type'), 'image/jpeg')

    const signedOut = await fetch(`${base}/foto/pending/${id}.jpg`)
    assert.equal(signedOut.status, 404, 'a pending photo is only ever visible to whoever uploaded it')
  } finally { server.close() }
})

test('a pending photo that does not exist is a 404', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const res = await fetch(`${base}/foto/pending/non-esiste.jpg`, { headers: { cookie: signedIn } })
    assert.equal(res.status, 404)
  } finally { server.close() }
})

test('GET /gita/nuova with no foto key at all is the picker', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const res = await fetch(`${base}/gita/nuova?itinerario=i1`, { headers: { cookie: signedIn } })
    const body = await res.text()
    assert.match(body, /name="foto"/)
    assert.equal(/name="foto_ids"/.test(body), false, 'this is screen 1, not screen 2')
  } finally { server.close() }
})

test('GET /gita/nuova with foto= present, empty, is screen 2 with zero photos', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const res = await fetch(`${base}/gita/nuova?itinerario=i1&foto=`, { headers: { cookie: signedIn } })
    const body = await res.text()
    assert.match(body, /name="foto_ids"/)
    assert.equal(/class="gita__foto"/.test(body), false)
  } finally { server.close() }
})

test('the full pick-then-caption journey: upload, land on screen 2 with the right figures', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', { csrf: token, email: 'v@example.it', password: 'una password lunga', nome: 'vale74' }, cookie)
    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const signedIn = `${cookie}; ${session}`

    const form = new FormData()
    form.append('csrf', token); form.append('itinerario', 'i1')
    form.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }), 'a.jpg')
    form.append('foto', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])], { type: 'image/png' }), 'b.png')
    const uploaded = await fetch(base + '/gita/foto', {
      method: 'POST', redirect: 'manual', headers: { cookie: signedIn }, body: form,
    })
    const location = uploaded.headers.get('location')!

    const screen2 = await fetch(new URL(location, base), { headers: { cookie: signedIn } })
    const body = await screen2.text()
    assert.equal((body.match(/class="gita__foto"/g) ?? []).length, 2)
  } finally { server.close() }
})

/**
 * Every other test in this file runs `createServer` over `memoryPhotoStore()`
 * (via `running()`), which proves the route logic but never the production
 * composition: real bytes, written to a real filesystem, surviving a process
 * boundary, served back through the real HTTP route. This is the one test
 * that wires `filesystemPhotoStore` into `createServer` directly, the way
 * `src/app/server.ts`'s own bootstrap does.
 */
test('a real filesystem-backed store works behind the real server, not just in isolation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-photo-'))
  const db = await freshDb()
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, { id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000, esposizione: 'SE', giorni: 1 },
    sections: {}, created: '2026-09-01T00:00:00.000Z' })

  const server = createServer(db, filesystemPhotoStore(dir), filesystemPhotoStore(join(dir, 'pending')), null, null)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  const base = `http://127.0.0.1:${port}`
  try {
    await fileAPhoto(base)
    const row = await db.get<{ id: string }>('select id from gita_photo')

    const res = await fetch(`${base}/foto/${row!.id}.jpg`)
    assert.equal(res.status, 200)
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xd8, 0xff, 1, 2, 3])
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})
