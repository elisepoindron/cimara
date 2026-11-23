import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citing } from '../helpers/cite.ts'
import { freshDb } from '../helpers/db.ts'
import type { Db } from '../../src/db/open.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { insertAccount } from '../../src/db/account.ts'
import { fileGita, insertImportedReport, retractGita } from '../../src/db/gita.ts'
import { saveSynthesis, synthesisFor } from '../../src/db/synthesis.ts'
import {
  backfillSyntheses, EVIDENCE_FLOOR, READING,
  type CallModel, type CallModelInput,
} from '../../src/app/synthesis.ts'

const NOW = new Date('2026-11-16T10:00:00.000Z')
const now = () => NOW

async function route(db: Db, id: string, name: string) {
  await insertItinerary(db, {
    id, activity: 'falesia', placeId: 'p1', name,
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'S', altMax: 900,
    facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
}

/** Unsigned reports, the way the seed and the importer write them. */
async function imported(db: Db, itineraryId: string, count: number, from = 0) {
  for (let i = from; i < from + count; i++) {
    await insertImportedReport(db, {
      id: `${itineraryId}-ir${i}`, itineraryId,
      observedAt: '2026-10-01', words: `Relazione importata numero ${i}.`,
    })
  }
}

async function scene(): Promise<Db> {
  const db = await freshDb()
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  return db
}

/** A fake that records which routes it was asked about and finds one theme in each. */
function recording() {
  const asked: string[] = []
  const fake: CallModel = async (input: CallModelInput) => {
    asked.push(input.itineraryName)
    return { themes: [{ label: 'Roccia unta', citations: citing(input, input.reports.slice(0, 2).map(r => r.id)) }] }
  }
  return { asked, fake }
}

test('a route that reached the floor through imported reports alone gets a synthesis', async () => {
  const db = await scene()
  await route(db, 'i1', 'Falesia della Croce'); await imported(db, 'i1', EVIDENCE_FLOOR)
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 1)

  assert.deepEqual(asked, ['Falesia della Croce'])
  const s = await synthesisFor(db, 'i1')
  assert.equal(s?.reportCount, EVIDENCE_FLOOR)
  assert.deepEqual(s?.themes.map(t => ({ label: t.label, count: t.count })), [{ label: 'Roccia unta', count: 2 }])
})

test('a route below the floor is read too, and its themes kept: two unsigned reports are two voices', async () => {
  const db = await scene()
  await route(db, 'i1', 'Poca'); await imported(db, 'i1', EVIDENCE_FLOOR - 1)
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 1)
  assert.equal(asked.length, 1)
  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes.map(t => [t.label, t.voices]), [['Roccia unta', 2]])
})

test('a route with no report at all is not asked about', async () => {
  const db = await scene()
  await route(db, 'i1', 'Vuota')
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 0)
  assert.deepEqual(asked, [])
})

test('a synthesis saved before its themes kept their reports is asked again, once', async () => {
  const db = await scene()
  await route(db, 'i1', 'Vecchia'); await imported(db, 'i1', EVIDENCE_FLOOR)
  await db.run(
    `insert into synthesis (itinerary_id, generated_at, report_count, themes) values (?, ?, ?, ?)`,
    ['i1', '2026-10-01T00:00:00.000Z', EVIDENCE_FLOOR, JSON.stringify([{ label: 'Vecchio', count: 3 }])])
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 1)
  assert.equal(asked.length, 1)
  assert.equal(await backfillSyntheses(db, fake, now), 0, 'now that its themes carry ids')
})

test('a synthesis an earlier reading made is asked again, once, even with its count unchanged', async () => {
  const db = await scene()
  await route(db, 'i1', 'Letta prima'); await imported(db, 'i1', 2)
  await saveSynthesis(db, 'i1', {
    generatedAt: '2026-10-01T00:00:00.000Z', reportCount: 2, flags: [], reading: READING - 1, readIds: [],
    themes: [{ label: 'Vecchio', count: 2, reportIds: ['x1', 'x2'] }],
  })
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 1)
  assert.deepEqual(asked, ['Letta prima'])
  assert.equal(await backfillSyntheses(db, fake, now), 0, 'now that the current reading made it')
})

test('a synthesis whose flags are bare sentences, with no name or kind, is asked again, once', async () => {
  const db = await scene()
  await route(db, 'i1', 'Vecchi segnali'); await imported(db, 'i1', 2)
  await db.run(
    `insert into synthesis (itinerary_id, generated_at, report_count, themes, flags) values (?, ?, ?, ?, ?)`,
    ['i1', '2026-10-01T00:00:00.000Z', 2, '[]', JSON.stringify([{ reportId: 'x', sentence: 'Spit nuovi.' }])])
  const { asked, fake } = recording()

  assert.equal(await backfillSyntheses(db, fake, now), 1)
  assert.deepEqual(asked, ['Vecchi segnali'])
  assert.equal(await backfillSyntheses(db, fake, now), 0, 'now that its flags are named')
})

test('signed and unsigned reports count together, and withdrawn ones do not', async () => {
  const db = await scene()
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await route(db, 'i1', 'Mista'); await imported(db, 'i1', EVIDENCE_FLOOR - 2)
  for (const g of ['g1', 'g2', 'g3']) {
    await fileGita(db, {
      id: g, itineraryId: 'i1', accountId: 'a1',
      observedAt: '2026-10-02', filedAt: '2026-10-02', words: `Gita ${g}.`,
    })
  }
  await retractGita(db, 'g3', NOW.toISOString())
  const { asked, fake } = recording()

  // EVIDENCE_FLOOR - 2 unsigned + 2 standing gite: exactly the floor.
  await backfillSyntheses(db, fake, now)
  assert.deepEqual(asked, ['Mista'])
  assert.equal((await synthesisFor(db, 'i1'))?.reportCount, EVIDENCE_FLOOR)
})

test('with no model configured, nothing is read or written', async () => {
  const db = await scene()
  await route(db, 'i1', 'Senza chiave'); await imported(db, 'i1', EVIDENCE_FLOOR)

  assert.equal(await backfillSyntheses(db, null, now), 0)
  assert.equal(await synthesisFor(db, 'i1'), null)
})

test('a route already synthesized from its current reports is not asked again', async () => {
  const db = await scene()
  await route(db, 'i1', 'Fatta'); await imported(db, 'i1', EVIDENCE_FLOOR)
  const { asked, fake } = recording()

  await backfillSyntheses(db, fake, now)
  await backfillSyntheses(db, fake, now)

  assert.deepEqual(asked, ['Fatta'])
})

test('a synthesis that found nothing is not asked again either', async () => {
  const db = await scene()
  await route(db, 'i1', 'Muta'); await imported(db, 'i1', EVIDENCE_FLOOR)
  let calls = 0
  const empty: CallModel = async () => { calls++; return { themes: [] } }

  await backfillSyntheses(db, empty, now)
  await backfillSyntheses(db, empty, now)

  assert.equal(calls, 1)
  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes, [])
})

test('reports imported after a synthesis make the route due again', async () => {
  const db = await scene()
  await route(db, 'i1', 'Cresciuta'); await imported(db, 'i1', EVIDENCE_FLOOR)
  await saveSynthesis(db, 'i1', {
    generatedAt: '2026-10-05T00:00:00.000Z', reportCount: EVIDENCE_FLOOR, reading: READING, readIds: [],
    themes: [{ label: 'Vecchio tema', count: 2, reportIds: [] }], flags: [],
  })
  await imported(db, 'i1', 3, EVIDENCE_FLOOR)
  const { asked, fake } = recording()

  await backfillSyntheses(db, fake, now)

  assert.deepEqual(asked, ['Cresciuta'])
  assert.equal((await synthesisFor(db, 'i1'))?.reportCount, EVIDENCE_FLOOR + 3)
})

test('a failed call keeps that route\'s cache and the pass goes on to the next', async () => {
  const db = await scene()
  await route(db, 'i1', 'Rotta'); await imported(db, 'i1', EVIDENCE_FLOOR + 1)
  await saveSynthesis(db, 'i1', {
    generatedAt: '2026-10-05T00:00:00.000Z', reportCount: EVIDENCE_FLOOR, reading: READING, readIds: [],
    themes: [{ label: 'Vecchio tema', count: 2, reportIds: [] }], flags: [],
  })
  await route(db, 'i2', 'Sana'); await imported(db, 'i2', EVIDENCE_FLOOR)
  const asked: string[] = []
  const flaky: CallModel = async (input: CallModelInput) => {
    asked.push(input.itineraryName)
    if (input.itineraryName === 'Rotta') throw new Error('rate limited')
    return { themes: [{ label: 'Tema', citations: citing(input, input.reports.slice(0, 2).map(r => r.id)) }] }
  }

  assert.equal(await backfillSyntheses(db, flaky, now), 2)

  assert.deepEqual(asked, ['Rotta', 'Sana'])     // most reports first
  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes, [{ label: 'Vecchio tema', count: 2, reportIds: [] }])
  assert.deepEqual((await synthesisFor(db, 'i2'))?.themes.map(t => t.label), ['Tema'])
})

test('routes are asked about one at a time, never in a burst', async () => {
  const db = await scene()
  for (const id of ['i1', 'i2', 'i3']) { await route(db, id, id); await imported(db, id, EVIDENCE_FLOOR) }
  let inFlight = 0, most = 0
  const slow: CallModel = async () => {
    inFlight++; most = Math.max(most, inFlight)
    await new Promise(r => setTimeout(r, 5))
    inFlight--
    return { themes: [] }
  }

  assert.equal(await backfillSyntheses(db, slow, now), 3)
  assert.equal(most, 1)
})
