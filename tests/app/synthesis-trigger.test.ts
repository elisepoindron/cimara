import { citing } from '../helpers/cite.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, post, tokenFrom } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import type { CallModel, CallModelInput } from '../../src/app/synthesis.ts'
import { EVIDENCE_FLOOR } from '../../src/app/synthesis.ts'
import { synthesisFor } from '../../src/db/synthesis.ts'

async function scene(callModel: CallModel) {
  const s = await running(callModel)
  await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(s.db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
             esposizione: 'SE', giorni: 1 },
    sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
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

async function fileOneGita(base: string, { token, cookie }: Session, i: number) {
  await post(base, '/gita', {
    csrf: token, itinerario: 'i1', quando: daysAgo(1), verdetto: 'buone',
    limite_neve: '3400', parole: `Relazione numero ${i}.`,
  }, cookie)
}

/** Waits for a fire-and-forget async job with no other signal to poll — the test's own fake
 * `callModel` is the only thing that knows when the real work finished. */
function untilCalled(calls: { count: number }, atLeast: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (calls.count >= atLeast) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`callModel not called ${atLeast} times in time`))
      setTimeout(check, 10)
    }
    check()
  })
}

test('filing enough reports triggers a synthesis, visible on the next page load', async () => {
  const calls = { count: 0 }
  const fake: CallModel = async (input: CallModelInput) => {
    calls.count++
    return { themes: [{ label: 'Tema comune', citations: citing(input, input.reports.slice(0, 3).map(r => r.id)) }] }
  }
  const { server, base } = await scene(fake)
  try {
    const session = await signedIn(base)
    for (let i = 0; i < EVIDENCE_FLOOR; i++) await fileOneGita(base, session, i)

    await untilCalled(calls, 1)

    // One climber filed them all: one voice. The theme shows on the reports it
    // was read from, and the route page counts none.
    const reports = parseHTML(await (await fetch(`${base}/itinerario/i1/relazioni`)).text()).document
    assert.ok([...reports.querySelectorAll('.slip__theme')].some(t => t.textContent === 'Tema comune'))
    const route = parseHTML(await (await fetch(`${base}/itinerario/i1`)).text()).document
    assert.equal(route.querySelectorAll('#relazioni .sum').length, 1)
    assert.equal(route.querySelectorAll('.sum__l > div').length, 0)
  } finally { server.close() }
})

test('withdrawing a report takes it out of its themes, with no model call', async () => {
  const calls = { count: 0 }
  // Every report read is put under one theme, so the theme's reports are the
  // reports read.
  const fake: CallModel = async (input: CallModelInput) => {
    calls.count++
    return { themes: [{ label: 'Tema comune', citations: citing(input, input.reports.map(r => r.id)) }] }
  }
  const { server, base, db } = await scene(fake)
  try {
    const session = await signedIn(base)
    for (let i = 0; i < 3; i++) {
      await fileOneGita(base, session, i)
      await untilCalled(calls, i + 1)
    }
    await new Promise(r => setTimeout(r, 200))   // let the last reading save
    const theme = async () => (await synthesisFor(db, 'i1'))?.themes.find(t => t.label === 'Tema comune')
    assert.equal((await theme())?.count, 3, 'each filing read its own report into the theme')
    const baseline = calls.count

    const rows = await db.all<{ id: string }>('select id from gita order by id limit 1')
    await post(base, `/gita/${rows[0]!.id}/ritira`, { csrf: session.token }, session.cookie)
    await new Promise(r => setTimeout(r, 200))

    assert.equal((await theme())?.count, 2)
    assert.equal((await theme())?.reportIds.includes(rows[0]!.id), false)
    assert.equal(calls.count, baseline, 'taking a report out needs no model')
  } finally { server.close() }
})

test('below the floor, filing still reads the report, but the route page shows no themes', async () => {
  const calls = { count: 0 }
  const fake: CallModel = async (input: CallModelInput) => {
    calls.count++
    return { themes: [{ label: 'Troppo presto', citations: citing(input, input.reports.map(r => r.id)) }] }
  }
  const { server, base } = await scene(fake)
  try {
    const session = await signedIn(base)
    await fileOneGita(base, session, 0)

    // One report can flag a broken hold, so the model is asked; a theme it
    // finds in one report is not a recurring one, and the page says none.
    await untilCalled(calls, 1)
    const doc = parseHTML(await (await fetch(`${base}/itinerario/i1`)).text()).document
    assert.equal(doc.querySelectorAll('#relazioni .sum__l > div').length, 0)
  } finally { server.close() }
})
