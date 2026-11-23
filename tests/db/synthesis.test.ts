import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { saveSynthesis, synthesisFor } from '../../src/db/synthesis.ts'

async function scene(db: Awaited<ReturnType<typeof freshDb>>) {
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
}

test('nothing cached yet reads back as null', async () => {
  const db = await freshDb(); await scene(db)
  assert.equal(await synthesisFor(db, 'i1'), null)
})

test('a saved synthesis reads back whole', async () => {
  const db = await freshDb(); await scene(db)

  await saveSynthesis(db, 'i1', {
    reading: 2, readIds: [], generatedAt: '2026-09-17T10:00:00.000Z', reportCount: 12,
    flags: [], themes: [{ label: 'Tempi più lunghi del previsto', count: 5, reportIds: [] }, { label: 'Roccia bagnata', count: 2, reportIds: [] }],
  })

  const row = await synthesisFor(db, 'i1')
  assert.equal(row?.itineraryId, 'i1')
  assert.equal(row?.reportCount, 12)
  assert.deepEqual(row?.themes, [
    { label: 'Tempi più lunghi del previsto', count: 5, reportIds: [] }, { label: 'Roccia bagnata', count: 2, reportIds: [] },
  ])
})

test('saving again replaces the row rather than adding a second one', async () => {
  const db = await freshDb(); await scene(db)

  await saveSynthesis(db, 'i1', { reading: 2, readIds: [], generatedAt: 'a', reportCount: 5, flags: [], themes: [{ label: 'X', count: 3, reportIds: [] }] })
  await saveSynthesis(db, 'i1', { reading: 2, readIds: [], generatedAt: 'b', reportCount: 9, flags: [], themes: [{ label: 'Y', count: 4, reportIds: [] }] })

  const rows = await db.all('select * from synthesis where itinerary_id = ?', ['i1'])
  assert.equal(rows.length, 1)
  const row = await synthesisFor(db, 'i1')
  assert.equal(row?.generatedAt, 'b')
  assert.equal(row?.reportCount, 9)
})

test('a write older than the row already there does not land', async () => {
  const db = await freshDb(); await scene(db)

  await saveSynthesis(db, 'i1', {
    reading: 2, readIds: [], generatedAt: '2026-09-17T10:00:00.000Z', reportCount: 9, flags: [], themes: [{ label: 'Nuovo', count: 4, reportIds: [] }],
  })
  // Two fire-and-forget regenerations racing: the one that read fewer reports
  // finishes last and must not be what the page then shows.
  await saveSynthesis(db, 'i1', {
    reading: 2, readIds: [], generatedAt: '2026-09-17T09:00:00.000Z', reportCount: 5, flags: [], themes: [{ label: 'Vecchio', count: 2, reportIds: [] }],
  })

  const row = await synthesisFor(db, 'i1')
  assert.equal(row?.reportCount, 9)
  assert.deepEqual(row?.themes, [{ label: 'Nuovo', count: 4, reportIds: [] }])
})

test('the themes column requires valid JSON array', async () => {
  const db = await freshDb(); await scene(db)

  // Attempting to insert a non-array value should fail the check constraint
  try {
    await db.run(
      `insert into synthesis (itinerary_id, generated_at, report_count, themes) values (?, ?, ?, ?)`,
      ['i1', '2026-09-17T10:00:00.000Z', 12, '{}'])
    assert.fail('Expected constraint violation for non-array JSON')
  } catch (err) {
    // Expected: constraint violation
    assert(err instanceof Error)
    assert(err.message.includes('constraint') || err.message.includes('CHECK constraint'))
  }
})

test('the reports behind each theme and the flagged sentences read back as saved', async () => {
  const db = await freshDb(); await scene(db)

  await saveSynthesis(db, 'i1', {
    reading: 2, readIds: [], generatedAt: '2026-09-17T10:00:00.000Z', reportCount: 6,
    themes: [{ label: 'Chiodatura curata', count: 2, reportIds: ['g1', 'g4'] }],
    flags: [{
      label: 'Scaglia staccata su Ciaplu', kind: 'attenzione',
      reportIds: ['g2'], quotes: { g2: 'Su Ciaplu si è staccata una scaglia' },
    }],
  })

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes, [{ label: 'Chiodatura curata', count: 2, reportIds: ['g1', 'g4'] }])
  assert.deepEqual(row?.flags, [{
    label: 'Scaglia staccata su Ciaplu', kind: 'attenzione',
    reportIds: ['g2'], quotes: { g2: 'Su Ciaplu si è staccata una scaglia' },
  }])
})

test('a flag saved as a bare sentence reads back as the page showed it: the sentence, as a warning', async () => {
  const db = await freshDb(); await scene(db)
  await db.run(
    `insert into synthesis (itinerary_id, generated_at, report_count, themes, flags) values (?, ?, ?, ?, ?)`,
    ['i1', '2026-09-01T00:00:00.000Z', 6, '[]',
     JSON.stringify([{ reportId: 'g2', sentence: 'Su Ciaplu si è staccata una scaglia' }])])

  assert.deepEqual((await synthesisFor(db, 'i1'))?.flags, [{
    label: 'Su Ciaplu si è staccata una scaglia', kind: 'attenzione',
    reportIds: ['g2'], quotes: { g2: 'Su Ciaplu si è staccata una scaglia' },
  }])
})

test('a row saved before migration 022 reads back with no ids and no flags, not broken', async () => {
  const db = await freshDb(); await scene(db)
  // Written the way the old code wrote it: a count per theme, no flags column given.
  await db.run(
    `insert into synthesis (itinerary_id, generated_at, report_count, themes) values (?, ?, ?, ?)`,
    ['i1', '2026-09-01T00:00:00.000Z', 8, JSON.stringify([{ label: 'Vecchio', count: 3 }])])

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes, [{ label: 'Vecchio', count: 3, reportIds: [] }])
  assert.deepEqual(row?.flags, [])
})
