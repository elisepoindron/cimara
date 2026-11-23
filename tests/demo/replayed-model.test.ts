import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { insertImportedReport } from '../../src/db/gita.ts'
import { synthesisFor } from '../../src/db/synthesis.ts'
import { regenerateSynthesis, READING } from '../../src/app/synthesis.ts'
import { replayedModel } from '../../src/demo/replayed-model.ts'

const WORDS = [
  'Avvicinamento di dieci minuti, roccia asciutta.',
  'Dal parcheggio sono dieci minuti. Hanno richiodato il settore basso.',
  'Pieno di gente, ma avvicinamento cortissimo.',
] as const

async function crag() {
  const db = await freshDb()
  await insertPlace(db, { id: 'p1', name: 'Arnad', kind: 'comune', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'falesia', placeId: 'p1', name: 'Prova',
    lat: 45.6, lon: 7.7, parkingLat: null, parkingLon: null, aspect: 'SO', altMax: 600,
    facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
  for (const [i, words] of WORDS.entries()) {
    await insertImportedReport(db, { id: `r${i}`, itineraryId: 'i1', observedAt: `2026-0${i + 3}-01`, words })
  }
  return db
}

test('a replayed reading is counted by the app, one voice per unsigned report', async () => {
  const db = await crag()
  const model = replayedModel([
    { words: WORDS[0], reading: { themes: [{ label: 'Avvicinamento breve', quote: 'Avvicinamento di dieci minuti' }] } },
    { words: WORDS[1], reading: {
      themes: [{ label: 'Avvicinamento breve', quote: 'Dal parcheggio sono dieci minuti' }],
      flags: [{ label: 'Settore basso richiodato', kind: 'novita', quote: 'Hanno richiodato il settore basso.' }],
    } },
    { words: WORDS[2], reading: { themes: [{ label: 'Avvicinamento breve', quote: 'avvicinamento cortissimo' }] } },
  ])
  await regenerateSynthesis(db, 'i1', 'Prova', model, new Date('2026-11-19T00:00:00Z'))
  const saved = await synthesisFor(db, 'i1')
  assert.equal(saved?.reading, READING)
  assert.deepEqual(saved?.readIds.length, 3)
  const theme = saved?.themes.find(t => t.label === 'Avvicinamento breve')
  assert.equal(theme?.count, 3)
  assert.equal(theme?.voices, 3)
  assert.deepEqual(saved?.flags.map(f => [f.label, f.kind, f.reportIds.length]), [['Settore basso richiodato', 'novita', 1]])
})

test('a recorded quote that is not in the words is dropped, as a live one would be', async () => {
  const db = await crag()
  const model = replayedModel([
    { words: WORDS[0], reading: { themes: [{ label: 'Roccia asciutta', quote: 'roccia bagnata' }] } },
    { words: WORDS[1], reading: undefined },
    { words: WORDS[2], reading: { themes: [{ label: 'Affollata', quote: 'Pieno di gente' }] } },
  ])
  await regenerateSynthesis(db, 'i1', 'Prova', model, new Date('2026-11-19T00:00:00Z'))
  const labels = (await synthesisFor(db, 'i1'))?.themes.map(t => t.label)
  assert.deepEqual(labels, ['Affollata'])
})
