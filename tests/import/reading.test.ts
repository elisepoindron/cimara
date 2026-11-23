import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb } from '../helpers/db.ts'
import { insertPlace } from '../../src/db/place.ts'
import { allItineraries } from '../../src/db/itinerary.ts'
import { importRows } from '../../src/import/run.ts'
import { reportOf } from '../../src/import/report.ts'
import { ACTIVITY_CODES, proseOf, translate, type Vocabulary } from '../../src/import/translate.ts'
import { cachedReader } from '../../src/import/reading-cache.ts'
import type { ReadRow, RowReading } from '../../src/import/reading.ts'
import type { ForeignRow } from '../../src/import/source.ts'
import type { Db } from '../../src/db/open.ts'

const KNOWN: Vocabulary = { activities: ACTIVITY_CODES, places: { Bussoleno: 'p-bussoleno' } }

const ROAD = 'Da Bussoleno salire alla frazione.'
const PARK = 'Si lascia il mezzo nello spiazzo.'
const WALK = 'Imboccare il sentiero a destra, 10 minuti.'
const HISTORY = 'Chiodata a metà anni 90.'
const NOW_STATE = 'Chiodatura buona e soste risistemate.'

const crag = (fields: Record<string, unknown> = {}): ForeignRow => ({
  riga: 7, titolo: 'Falesia Letta', zona: 'Bussoleno', att: 2,
  q_part: 700, q_max: 740, esp: 'S', min_avv: 10, data: '01/07/2020',
  vie: [{ n: 1, nome: 'Prima', grado: '5a', lung: 14 }],
  note: `${HISTORY} ${NOW_STATE}`,
  avvicinamento: `${ROAD} ${PARK} ${WALK}`,
  ...fields,
})

/** What Haiku said on the real crags, in shape: right on the approach, half right on the rest. */
const READING: RowReading = { sentences: [
  { from: 'note', text: HISTORY, to: 'history' },
  { from: 'note', text: NOW_STATE, to: 'history' },
  { from: 'avvicinamento', text: ROAD, to: 'road' },
  { from: 'avvicinamento', text: PARK, to: 'parking' },
  { from: 'avvicinamento', text: WALK, to: 'walk' },
] }

function accepted(t: ReturnType<typeof translate>) {
  if (!t.ok) assert.fail(t.refusals.map(r => `${r.field}: ${r.reason}`).join('; '))
  return t
}

// --- translate, handed a reading

test('a reading that passes the check sorts the approach, and parks the car in its own box', () => {
  const t = accepted(translate(crag(), KNOWN, READING))
  assert.equal(t.itinerary.facts.come_arrivare, ROAD)
  assert.equal(t.itinerary.facts.parcheggio_nota, PARK,
    'the word rule would have left all of it in avvicinamento: "il mezzo" names neither car nor parking')
  assert.equal(t.itinerary.sections.avvicinamento, WALK)
  assert.match(t.interpretations[0]!.readAs, /model’s reading, checked/)
})

test('whatever else the reading says is a suggestion, and nothing moves', () => {
  const t = accepted(translate(crag(), KNOWN, READING))
  assert.equal(t.itinerary.sections.note, `${HISTORY} ${NOW_STATE}`, 'the note is as it was typed')
  assert.equal('storia' in t.itinerary.sections, false)
  assert.deepEqual(t.suggestions.map(s => [s.field, s.sentence, s.to]),
    [['note', HISTORY, 'history'], ['note', NOW_STATE, 'history']],
    'both listed, the right one and the wrong one: a person tells them apart')
})

test('a note read as presentation is a note left where it was: nothing to suggest', () => {
  const t = accepted(translate(crag(), KNOWN, { sentences: [
    { from: 'note', text: HISTORY, to: 'presentation' },
    { from: 'note', text: NOW_STATE, to: 'here' },
  ] }))
  assert.deepEqual(t.suggestions, [])
})

test('a reading that rewrote a word is not used: the rule sorts the approach', () => {
  const t = accepted(translate(crag(), KNOWN, { sentences: [
    { from: 'avvicinamento', text: ROAD, to: 'road' },
    { from: 'avvicinamento', text: 'Si lascia l’auto nello spiazzo.', to: 'parking' },
    { from: 'avvicinamento', text: WALK, to: 'walk' },
  ] }))
  assert.equal('parcheggio_nota' in t.itinerary.facts, false)
  assert.equal(t.itinerary.sections.avvicinamento, `${ROAD} ${PARK} ${WALK}`,
    'and the rule finds no road it knows, so the text stays where it was typed')
  assert.match(t.suggestions.map(s => s.sentence).join(' | '), /Da Bussoleno/,
    'the road it proposed is still shown, since nothing acted on it')
  assert.equal(t.suggestions.some(s => s.sentence.includes('l’auto')), false,
    'a sentence that is not in the source is never shown as if it were')
})

test('without a reading, translation is what it was', () => {
  const t = accepted(translate(crag(), KNOWN))
  assert.deepEqual(t.suggestions, [])
  assert.equal(t.itinerary.sections.avvicinamento, `${ROAD} ${PARK} ${WALK}`)
})

test('a row’s prose is the boxes its activity maps, by section id', () => {
  assert.deepEqual(proseOf(crag({ storico: '  ' }), KNOWN),
    { note: `${HISTORY} ${NOW_STATE}`, avvicinamento: `${ROAD} ${PARK} ${WALK}` })
  assert.deepEqual(proseOf(crag({ att: 9 }), KNOWN), {}, 'an activity this import cannot read sends nothing')
})

// --- the run loop

async function bussoleno(): Promise<Db> {
  const db = await freshDb()
  await insertPlace(db, { id: 'p-bussoleno', name: 'Bussoleno', kind: 'comune', parentId: null })
  return db
}

test('the run asks once per new row, writes what the reading sorted, and reports the rest', async () => {
  const db = await bussoleno()
  const asked: Record<string, string>[] = []
  const read: ReadRow = async boxes => { asked.push({ ...boxes }); return READING }

  const result = await importRows(db, [crag()], read)
  assert.equal(result.written, 1)
  assert.equal(asked.length, 1)
  const [it] = await allItineraries(db)
  assert.equal(it!.facts.parcheggio_nota, PARK)
  assert.deepEqual(result.reading, { asked: 1, unread: 0 })

  const text = reportOf(result)
  assert.match(text, /The model read 1 of the 1 new rows/)
  assert.match(text, /Suggested by the model, and nothing was moved/)
  assert.match(text, /riga 7, note: "Chiodatura buona e soste risistemate\." reads as history/)
})

test('a row refused, or already held, is never sent', async () => {
  const db = await bussoleno()
  let calls = 0
  const read: ReadRow = async () => { calls++; return READING }
  await importRows(db, [crag()], read)
  calls = 0

  const result = await importRows(db, [crag(), crag({ riga: 8, titolo: 'Altrove', zona: 'Nessunposto' })], read)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.refused.length > 0, true)
  assert.equal(calls, 0)
})

test('a reader that fails leaves the row to the rule, and the report says so', async () => {
  const db = await bussoleno()
  const read: ReadRow = async () => { throw new Error('overloaded') }
  const result = await importRows(db, [crag()], read)
  assert.equal(result.written, 1)
  assert.deepEqual(result.reading, { asked: 1, unread: 1 })
  assert.deepEqual(result.suggested, [])
  assert.match(reportOf(result), /1 could not be read and were sorted by the word rule alone/)
})

test('with no reader the report says nothing about one', async () => {
  const db = await bussoleno()
  const result = await importRows(db, [crag()])
  assert.equal(result.reading, null)
  assert.doesNotMatch(reportOf(result), /model/)
})

// --- the cache

test('a reading is asked once, kept on disk, and asked again only when the question or the words change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readings-'))
  try {
    const file = join(dir, 'archivio.json.readings.jsonl')
    let calls = 0
    const inner: ReadRow = async () => { calls++; return READING }
    const boxes = { avvicinamento: `${ROAD} ${PARK} ${WALK}` }

    assert.deepEqual(await cachedReader(inner, file, 'v1')(boxes), READING)
    assert.deepEqual(await cachedReader(inner, file, 'v1')(boxes), READING, 'a second run reads the file')
    assert.equal(calls, 1)

    await cachedReader(inner, file, 'v2')(boxes)
    assert.equal(calls, 2, 'a new question reads again')
    await cachedReader(inner, file, 'v2')({ avvicinamento: WALK })
    assert.equal(calls, 3, 'so do new words')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed reading is not kept, and a line cut short is read past', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readings-'))
  try {
    const file = join(dir, 'r.jsonl')
    writeFileSync(file, '{"key":"abc","readi\n')
    let calls = 0
    const failing: ReadRow = async () => { calls++; return null }
    const reader = cachedReader(failing, file, 'v1')
    assert.equal(await reader({ note: 'x' }), null)
    assert.equal(await reader({ note: 'x' }), null)
    assert.equal(calls, 2)
    assert.equal(readFileSync(file, 'utf8'), '{"key":"abc","readi\n', 'nothing was appended')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
