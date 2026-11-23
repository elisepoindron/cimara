import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, post, tokenFrom, type RunningServer } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'
import { saveSynthesis } from '../../src/db/synthesis.ts'
import { READING } from '../../src/app/synthesis.ts'

/** One alpine route, invented, in a fresh in-memory database — enough for a report to be filed against it. */
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

const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const GOOD = {
  itinerario: 'i1', quando: daysAgo(2), verdetto: 'buone',
  limite_neve: '3400', parole: 'Neve dura sopra i 3200.',
}

interface GetResult { readonly status: number; readonly body: string }

async function get(base: string, path: string, cookie = ''): Promise<GetResult> {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} })
  return { status: res.status, body: await res.text() }
}

test('after filing, the route page links to reading the relazione back', async () => {
  const { server, base } = await scene()
  try {
    const { token, cookie } = await signedIn(base)
    await post(base, '/gita', { csrf: token, ...GOOD }, cookie)

    const doc = parseHTML((await get(base, '/itinerario/i1', cookie)).body).document
    assert.equal(doc.querySelector('#relazioni a.sum__go')?.getAttribute('href'), '/itinerario/i1/relazioni')
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

/** Two reports filed, and a reading of them saved as if the model had made it. */
async function readScene() {
  const s = await scene()
  const { token, cookie } = await signedIn(s.base)
  await post(s.base, '/gita', { csrf: token, ...GOOD, quando: daysAgo(3), parole: 'Spit vicini, ottimo.' }, cookie)
  await post(s.base, '/gita', { csrf: token, ...GOOD, quando: daysAgo(1), parole: 'Crollata la scaglia del traverso.' }, cookie)
  const [newest, older] = await giteFor(s.db, 'i1')
  await saveSynthesis(s.db, 'i1', {
    generatedAt: new Date().toISOString(), reportCount: 2, reading: READING, readIds: [newest!.id, older!.id],
    themes: [{ label: 'Spit vicini', count: 1, voices: 1, reportIds: [older!.id] }],
    flags: [{ label: 'Scaglia caduta', kind: 'attenzione', reportIds: [newest!.id], quotes: { [newest!.id]: 'Crollata la scaglia del traverso.' } }],
  })
  return { ...s, newest: newest!, older: older! }
}

test('?tema= on the relazioni page shows only the reports in that theme', async () => {
  const { server, base, older } = await readScene()
  try {
    const doc = parseHTML((await get(base, '/itinerario/i1/relazioni?tema=Spit%20vicini')).body).document
    assert.deepEqual([...doc.querySelectorAll('.slip')].map(s => s.id), [`relazione-${older.id}`])

    const all = parseHTML((await get(base, '/itinerario/i1/relazioni')).body).document
    assert.equal(all.querySelectorAll('.slip').length, 2)
  } finally { server.close() }
})

test('the route page names a change under Attenzione, dated, as plain text', async () => {
  const { server, base } = await readScene()
  try {
    const doc = parseHTML((await get(base, '/itinerario/i1')).body).document
    const line = doc.querySelector('#relazioni .sum__g--attenzione > div:not(.sum__gh)')
    assert.equal(line?.querySelector('span')?.textContent, 'Scaglia caduta')
    assert.equal(line?.querySelectorAll('a').length, 0, 'the reports are reached from the top of the box')
    assert.ok(line?.querySelector('small')?.textContent?.endsWith(daysAgo(1).slice(0, 4)), 'dated, with its year')
  } finally { server.close() }
})
