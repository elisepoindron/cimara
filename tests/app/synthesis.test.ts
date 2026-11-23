import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citing } from '../helpers/cite.ts'
import { freshDb } from '../helpers/db.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { insertAccount } from '../../src/db/account.ts'
import { fileGita } from '../../src/db/gita.ts'
import { synthesisFor, saveSynthesis } from '../../src/db/synthesis.ts'
import { giteFor } from '../../src/db/gita.ts'
import {
  regenerateSynthesis, updateSynthesis, applyMerges, EVIDENCE_FLOOR, QUOTES_FOR_MERGE, READING,
  type CallModel, type CallModelInput, type MergeThemes,
} from '../../src/app/synthesis.ts'

async function scene(db: Awaited<ReturnType<typeof freshDb>>, reportCount: number) {
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'vale74' })
  await insertPlace(db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
  await insertItinerary(db, {
    id: 'i1', activity: 'alpinismo', placeId: 'p1', name: 'Prova',
    lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
    facts: {}, sections: {}, created: '2026-09-01T00:00:00.000Z',
  })
  for (let i = 0; i < reportCount; i++) {
    await fileGita(db, {
      id: `g${i}`, itineraryId: 'i1', accountId: 'a1',
      observedAt: '2026-09-01', filedAt: '2026-09-01', words: `Relazione numero ${i}.`,
    })
  }
}

const NOW = new Date('2026-09-17T10:00:00.000Z')

const labelCount = (t: { label: string; count: number }) => ({ label: t.label, count: t.count })

test('with no report at all, the model is never called and nothing is saved', async () => {
  const db = await freshDb(); await scene(db, 0)
  let calls = 0
  const fake: CallModel = async () => { calls++; return { themes: [] } }

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.equal(calls, 0)
  assert.equal(await synthesisFor(db, 'i1'), null)
})

test('from the first report, themes are read and kept, flags too', async () => {
  const db = await freshDb(); await scene(db, 1)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'Tiri brevi', citations: citing(input, ['g0']) }],
    flags: [{ label: 'Scaglia staccata', kind: 'attenzione', citations: citing(input, ['g0']) }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes.map(t => [t.label, t.reportIds, t.voices]), [['Tiri brevi', ['g0'], 1]])
  assert.deepEqual(row?.flags, [{
    label: 'Scaglia staccata', kind: 'attenzione', reportIds: ['g0'], quotes: { g0: 'Relazione numero 0.' },
  }])
})

test('a hallucinated report id is dropped before counting', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'Tempi lunghi', citations: citing(input, [...input.reports.slice(0, 2).map(r => r.id), 'not-real']) }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes.map(labelCount), [{ label: 'Tempi lunghi', count: 2 }])
})

test('a theme one person raised is kept, as one voice, beside one two people share', async () => {
  const db = await freshDb(); await scene(db, 4)
  // g2 and g3 by a second climber: the same person twice is still one voice.
  await insertAccount(db, { id: 'a2', email: 'f@example.it', passwordHash: 'h', displayName: 'mirko' })
  await db.run(`update gita set account_id = 'a2' where id in ('g2', 'g3')`)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [
      { label: 'Solo una persona', citations: citing(input, ['g2', 'g3']) },
      { label: 'Due persone', citations: citing(input, ['g0', 'g2']) },
      { label: 'Una relazione', citations: citing(input, ['g1']) },
    ],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  const themes = (await synthesisFor(db, 'i1'))?.themes ?? []
  // Most voices first, then most reports.
  assert.deepEqual(themes.map(t => [t.label, t.count, t.voices]),
    [['Due persone', 2, 2], ['Solo una persona', 2, 1], ['Una relazione', 1, 1]])
})

test('every theme is kept, with no cap', async () => {
  const db = await freshDb(); await scene(db, 12)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [1, 2, 2, 3, 4, 5, 6].map((n, i) => ({
      label: `Tema ${i}`, citations: citing(input, input.reports.slice(0, n).map(r => r.id)),
    })),
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes.map(t => t.count), [6, 5, 4, 3, 2, 2, 1])
})


test('a duplicated report id in one theme counts once, not twice', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'Ripetuto', citations: citing(input, [input.reports[0]!.id, input.reports[0]!.id, input.reports[1]!.id]) }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.equal((await synthesisFor(db, 'i1'))?.themes[0]?.count, 2)
})

test('when the model call fails, a previous good synthesis is left untouched', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const good: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'Buono', citations: citing(input, input.reports.slice(0, 3).map(r => r.id)) }],
  })
  await regenerateSynthesis(db, 'i1', 'Prova', good, NOW)

  const failing: CallModel = async () => { throw new Error('rate limited') }
  await regenerateSynthesis(db, 'i1', 'Prova', failing, NOW)

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes.map(labelCount), [{ label: 'Buono', count: 3 }])
})

test('a successful call that grounds to zero themes is saved as empty, not treated as failure', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const empty: CallModel = async () => ({ themes: [] })

  await regenerateSynthesis(db, 'i1', 'Prova', empty, NOW)

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes, [])
  assert.equal(row?.reportCount, EVIDENCE_FLOOR)
})

test('with no model configured, a previous good synthesis is left exactly as it was', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  let calls = 0
  const good: CallModel = async (input: CallModelInput) => {
    calls++
    return { themes: [{ label: 'Buono', citations: citing(input, input.reports.slice(0, 3).map(r => r.id)) }] }
  }
  await regenerateSynthesis(db, 'i1', 'Prova', good, NOW)
  const before = await synthesisFor(db, 'i1')
  assert.equal(calls, 1)

  // An empty result is a verdict worth saving; a missing key is not a verdict
  // at all, and must not be allowed to overwrite one.
  await regenerateSynthesis(db, 'i1', 'Prova', null, new Date('2026-09-18T10:00:00.000Z'))

  assert.equal(calls, 1)
  assert.deepEqual(await synthesisFor(db, 'i1'), before)
})

test('a theme whose label is blank is dropped, however well supported', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [
      { label: '   ', citations: citing(input, input.reports.map(r => r.id)) },
      { label: '  Con spazi  ', citations: citing(input, input.reports.slice(0, 2).map(r => r.id)) },
    ],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes.map(labelCount), [{ label: 'Con spazi', count: 2 }])
})

test('an overlong label is cut down rather than rendered whole', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'a'.repeat(400), citations: citing(input, input.reports.slice(0, 2).map(r => r.id)) }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  const label = (await synthesisFor(db, 'i1'))?.themes[0]?.label ?? ''
  assert.equal(label.length, 80)
})

test('a theme keeps the ids of the reports it was counted from, once each', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async (input: CallModelInput) => ({
    themes: [{ label: 'Chiodatura', citations: citing(input, ['g1', 'g1', 'g3', 'not-real']) }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes,
    [{
      label: 'Chiodatura', count: 2, reportIds: ['g1', 'g3'], voices: 1,
      quotes: { g1: 'Relazione numero 1.', g3: 'Relazione numero 3.' },
    }])
})

test('a report is counted in a theme only when the words quoted for it are in it', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async () => ({
    themes: [{
      label: 'Ambiente panoramico',
      citations: [
        { reportId: 'g1', quote: 'numero 1' },
        { reportId: 'g2', quote: 'numero 2' },
        // Reworded, or never written: not evidence, so g3 is not counted.
        { reportId: 'g3', quote: 'vista splendida' },
        { reportId: 'g4', quote: '   ' },
      ],
    }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  const [theme] = (await synthesisFor(db, 'i1'))?.themes ?? []
  assert.equal(theme?.count, 2)
  assert.deepEqual(theme?.reportIds, ['g1', 'g2'])
  assert.deepEqual(theme?.quotes, { g1: 'numero 1', g2: 'numero 2' })
})

test('the model is shown the labels the route showed last time, and none the first time', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const seen: (readonly string[])[] = []
  const fake: CallModel = async (input: CallModelInput) => {
    seen.push(input.previousLabels)
    return { themes: [{ label: 'Chiodatura ravvicinata', citations: citing(input, ['g1', 'g2']) }] }
  }

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)
  await regenerateSynthesis(db, 'i1', 'Prova', fake, new Date(NOW.getTime() + 1000))

  assert.deepEqual(seen, [[], ['Chiodatura ravvicinata']])
})

test('a flag keeps only the reports whose sentence is exactly in their words', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async () => ({
    themes: [],
    flags: [{
      label: 'Nuovi tiri', kind: 'novita', citations: [
        { reportId: 'g1', quote: '  Relazione numero 1.  ' },   // verbatim once trimmed: kept
        { reportId: 'g2', quote: 'Relazione n. 2' },            // a paraphrase: dropped
        { reportId: 'g3', quote: 'Relazione numero 4.' },       // another report's words: dropped
        { reportId: 'not-real', quote: 'Relazione numero 0.' }, // never sent: dropped
        { reportId: 'g4', quote: '   ' },                       // blank: dropped
      ],
    }],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.flags, [{
    label: 'Nuovi tiri', kind: 'novita', reportIds: ['g1'], quotes: { g1: 'Relazione numero 1.' },
  }])
})

test('a flag of no known kind, or with no report left, is not kept', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async input => ({
    themes: [],
    flags: [
      { label: 'Chissà', kind: 'pericolo', citations: citing(input, ['g1']) },
      { label: 'Inventato', kind: 'attenzione', citations: citing(input, ['not-real']) },
      { label: 'Spit nuovi', kind: 'novita', citations: citing(input, ['g2']) },
    ],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.flags.map(f => f.label), ['Spit nuovi'])
})

test('one change several reports record is one flag citing them all, flags newest first', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const fake: CallModel = async input => ({
    themes: [],
    flags: [
      { label: 'Scaglia staccata', kind: 'attenzione', citations: citing(input, ['g3']) },
      { label: 'Nuovi tiri', kind: 'novita', citations: citing(input, ['g4', 'g1']) },
    ],
  })

  await regenerateSynthesis(db, 'i1', 'Prova', fake, NOW)

  // Whichever flag holds the report `giteFor` lists first comes first.
  const sent = (await giteFor(db, 'i1')).map(g => g.id)
  const newest = (ids: readonly string[]) => Math.min(...ids.map(id => sent.indexOf(id)))
  const flags = (await synthesisFor(db, 'i1'))?.flags ?? []
  assert.deepEqual(flags.map(f => [f.label, [...f.reportIds].sort()]).sort(),
    [['Nuovi tiri', ['g1', 'g4']], ['Scaglia staccata', ['g3']]])
  assert.ok(newest(flags[0]!.reportIds) < newest(flags[1]!.reportIds))
})

/** A model whose first reading is `read` and whose second is `check`. */
const withCheck = (read: CallModel, check: NonNullable<CallModel['check']>): CallModel =>
  Object.assign(async (input: CallModelInput) => read(input), { check })

test('the second reading splits a theme its quotes say in parts, so each report keeps its place', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const asked: string[] = []
  const model = withCheck(
    async input => ({ themes: [
      { label: 'Ambiente bello e panoramico', citations: citing(input, ['g0', 'g1', 'g2', 'g3']) },
      { label: 'Tiri brevi', citations: citing(input, ['g2', 'g4']) },
    ] }),
    async input => {
      asked.push(...input.themes.map(t => `${t.label}: ${t.citations.map(c => c.quote).join(' | ')}`))
      return {
        themes: [
          { from: 0, label: 'Bel posto', reportIds: ['g0', 'g1', 'g3'] },
          { from: 0, label: 'Vista panoramica', reportIds: ['g3'] },   // one report: still that report's theme
          { from: 1, label: 'Tiri brevi', reportIds: ['g4'] },         // g2 left out: g4 keeps it
        ],
        flags: [],
      }
    },
  )

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  assert.deepEqual(asked, [
    'Ambiente bello e panoramico: Relazione numero 0. | Relazione numero 1. | Relazione numero 2. | Relazione numero 3.',
    'Tiri brevi: Relazione numero 2. | Relazione numero 4.',
  ], 'it sees the grounded quotes, theme by theme')
  const themes = (await synthesisFor(db, 'i1'))?.themes ?? []
  assert.deepEqual(themes.map(t => [t.label, [...t.reportIds].sort()]).sort(),
    [['Bel posto', ['g0', 'g1', 'g3']], ['Tiri brevi', ['g4']], ['Vista panoramica', ['g3']]])
  assert.equal(themes[0]?.label, 'Bel posto', 'most reports first')
  assert.equal(themes[0]?.quotes?.g1, 'Relazione numero 1.', 'the quote is the first reading\'s, grounded')
})

test('the second reading cannot bring in a report its source did not quote', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const model = withCheck(
    async input => ({ themes: [
      { label: 'Tema', citations: citing(input, ['g1', 'g2']) },
      { label: 'Altro', citations: citing(input, ['g3', 'g4']) },
    ] }),
    async () => ({
      themes: [
        { from: 0, label: 'Tema', reportIds: ['g1', 'g2', 'g3', 'not-real'] },
        { from: 7, label: 'Da nessuna parte', reportIds: ['g3', 'g4'] },
      ],
      flags: [],
    }),
  )

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes.map(t => [t.label, [...t.reportIds].sort()]),
    [['Tema', ['g1', 'g2']]])
})

test('two parts given the same name become one theme', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const model = withCheck(
    async input => ({ themes: [
      { label: 'Spit vicini', citations: citing(input, ['g1', 'g2']) },
      { label: 'Chiodatura ravvicinata', citations: citing(input, ['g3', 'g4']) },
    ] }),
    async () => ({
      themes: [
        { from: 0, label: 'Chiodatura ravvicinata', reportIds: ['g1', 'g2'] },
        { from: 1, label: 'Chiodatura ravvicinata', reportIds: ['g3', 'g4'] },
      ],
      flags: [],
    }),
  )

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  const themes = (await synthesisFor(db, 'i1'))?.themes ?? []
  assert.deepEqual(themes.map(t => [t.label, t.count]), [['Chiodatura ravvicinata', 4]])
})

test('the second reading checks flags too: it can drop one, and keeps only known kinds', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const model = withCheck(
    async input => ({ themes: [], flags: [
      { label: 'Molta neve', kind: 'attenzione', citations: citing(input, ['g1']) },
      { label: 'Nuovi tiri e spit cambiati', kind: 'novita', citations: citing(input, ['g2', 'g3']) },
    ] }),
    async input => {
      assert.deepEqual(input.flags.map(f => f.kind), ['attenzione', 'novita'])
      return {
        themes: [],
        flags: [   // "Molta neve" is the day, not a change: left out
          { from: 1, label: 'Nuovi tiri', kind: 'novita', reportIds: ['g2'] },
          { from: 1, label: 'Spit cambiati', kind: 'novita', reportIds: ['g3'] },
          { from: 1, label: 'Boh', kind: 'altro', reportIds: ['g3'] },
        ],
      }
    },
  )

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  const flags = (await synthesisFor(db, 'i1'))?.flags ?? []
  assert.deepEqual(flags.map(f => [f.label, f.kind, f.reportIds]).sort(),
    [['Nuovi tiri', 'novita', ['g2']], ['Spit cambiati', 'novita', ['g3']]])
})

test('a failed second reading keeps the previous cache', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const first: CallModel = async input => ({ themes: [{ label: 'Prima', citations: citing(input, ['g1', 'g2']) }] })
  await regenerateSynthesis(db, 'i1', 'Prova', first, NOW)

  const flaky = withCheck(
    async input => ({ themes: [{ label: 'Dopo', citations: citing(input, ['g1', 'g2']) }] }),
    async () => { throw new Error('rate limited') },
  )
  await regenerateSynthesis(db, 'i1', 'Prova', flaky, new Date(NOW.getTime() + 1000))

  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes.map(t => t.label), ['Prima'])
})

test('with no theme and no flag to check, the second reading is not asked', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  let checks = 0
  const model = withCheck(async () => ({ themes: [] }), async () => { checks++; return { themes: [], flags: [] } })

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  assert.equal(checks, 0)
  assert.deepEqual((await synthesisFor(db, 'i1'))?.themes, [])
})

// ---------------------------------------------------------------------------
// Reading only what is new
// ---------------------------------------------------------------------------

async function fileOne(db: Awaited<ReturnType<typeof freshDb>>, id: string, words: string) {
  await fileGita(db, {
    id, itineraryId: 'i1', accountId: 'a1', observedAt: '2026-09-02', filedAt: '2026-09-02', words,
  })
}

test('a new report is read on its own, its points placed under the names the route already has', async () => {
  const db = await freshDb(); await scene(db, 3)
  const first: CallModel = async input => ({ themes: [
    { label: 'Tiri brevi', citations: citing(input, ['g0', 'g1']) },
    { label: 'Roccia buona', citations: citing(input, ['g2']) },
  ] })
  await updateSynthesis(db, 'i1', 'Prova', first, NOW)

  await fileOne(db, 'g9', 'Tiri corti. Spit vicini.')
  const seen: CallModelInput[] = []
  const next: CallModel = async input => {
    seen.push(input)
    return { themes: [
      { label: 'Tiri brevi', citations: [{ reportId: 'g9', quote: 'Tiri corti' }] },
      { label: 'Chiodatura ravvicinata', citations: [{ reportId: 'g9', quote: 'Spit vicini' }] },
    ] }
  }
  await updateSynthesis(db, 'i1', 'Prova', next, new Date(NOW.getTime() + 1000))

  assert.deepEqual(seen.map(i => i.reports.map(r => r.id)), [['g9']], 'only the new report is sent')
  assert.deepEqual([...seen[0]!.previousLabels].sort(), ['Roccia buona', 'Tiri brevi'])
  const row = await synthesisFor(db, 'i1')
  const theme = (l: string) => row?.themes.find(t => t.label === l)
  assert.deepEqual([...theme('Tiri brevi')!.reportIds].sort(), ['g0', 'g1', 'g9'])
  assert.equal(theme('Tiri brevi')?.quotes?.g0, 'Relazione numero 0.', 'what was read stays as it was')
  assert.deepEqual(theme('Chiodatura ravvicinata')?.reportIds, ['g9'])
  assert.deepEqual(theme('Roccia buona')?.reportIds, ['g2'])
  assert.equal(row?.reportCount, 4)
  assert.deepEqual([...row!.readIds].sort(), ['g0', 'g1', 'g2', 'g9'])
})

test('with nothing new to read, the model is not called', async () => {
  const db = await freshDb(); await scene(db, 2)
  let calls = 0
  const model: CallModel = async input => { calls++; return { themes: [{ label: 'T', citations: citing(input, ['g0']) }] } }
  await updateSynthesis(db, 'i1', 'Prova', model, NOW)
  await updateSynthesis(db, 'i1', 'Prova', model, new Date(NOW.getTime() + 1000))
  assert.equal(calls, 1)
})

test('a report that had no point is still read, and not sent again', async () => {
  const db = await freshDb(); await scene(db, 2)
  const sent: string[][] = []
  const model: CallModel = async input => { sent.push(input.reports.map(r => r.id)); return { themes: [] } }
  await updateSynthesis(db, 'i1', 'Prova', model, NOW)
  await fileOne(db, 'g9', 'Niente da dire.')
  await updateSynthesis(db, 'i1', 'Prova', model, new Date(NOW.getTime() + 1000))
  assert.equal(sent.length, 2)
  assert.deepEqual([...sent[0]!].sort(), ['g0', 'g1'])
  assert.deepEqual(sent[1], ['g9'], 'g0 and g1 had no point and are not sent again')
})

test('a failed reading saves nothing new and leaves the report to be read later', async () => {
  const db = await freshDb(); await scene(db, 2)
  await updateSynthesis(db, 'i1', 'Prova', async input => ({ themes: [{ label: 'T', citations: citing(input, ['g0']) }] }), NOW)
  await fileOne(db, 'g9', 'Tiri corti.')
  await updateSynthesis(db, 'i1', 'Prova', async () => { throw new Error('rate limited') }, new Date(NOW.getTime() + 1000))

  const row = await synthesisFor(db, 'i1')
  assert.equal(row?.readIds.includes('g9'), false)
  let sent: string[] = []
  await updateSynthesis(db, 'i1', 'Prova', async input => { sent = input.reports.map(r => r.id); return { themes: [] } },
    new Date(NOW.getTime() + 2000))
  assert.deepEqual(sent, ['g9'], 'the next reading picks it up')
})

test('a withdrawn report leaves its themes and flags, with no model, and an emptied one goes', async () => {
  const db = await freshDb(); await scene(db, 3)
  await updateSynthesis(db, 'i1', 'Prova', async input => ({
    themes: [
      { label: 'Tiri brevi', citations: citing(input, ['g0', 'g1']) },
      { label: 'Solo g2', citations: citing(input, ['g2']) },
    ],
    flags: [{ label: 'Scaglia staccata', kind: 'attenzione', citations: citing(input, ['g2']) }],
  }), NOW)
  await db.run(`insert into retraction (gita_id, retracted_at) values ('g2', '2026-09-18')`)

  await updateSynthesis(db, 'i1', 'Prova', null, new Date(NOW.getTime() + 1000))

  const row = await synthesisFor(db, 'i1')
  assert.deepEqual(row?.themes.map(t => t.label), ['Tiri brevi'])
  assert.deepEqual(row?.flags, [])
  assert.deepEqual([...row!.readIds].sort(), ['g0', 'g1'])
  assert.equal(row?.reportCount, 2)
})

test('a synthesis an earlier reading made is read again whole, its names offered', async () => {
  const db = await freshDb(); await scene(db, 2)
  await saveSynthesis(db, 'i1', {
    generatedAt: '2026-09-01T00:00:00.000Z', reportCount: 2, reading: READING - 1, readIds: ['g0', 'g1'],
    themes: [{ label: 'Vecchio nome', count: 2, reportIds: ['g0', 'g1'] }], flags: [],
  })
  let seen: CallModelInput | undefined
  await updateSynthesis(db, 'i1', 'Prova', async input => { seen = input; return { themes: [] } }, NOW)
  assert.deepEqual(seen?.reports.map(r => r.id).sort(), ['g0', 'g1'])
  assert.deepEqual(seen?.previousLabels, ['Vecchio nome'])
  assert.equal((await synthesisFor(db, 'i1'))?.reading, READING)
})

test('the check sees only what the new report brought, not the themes already there', async () => {
  const db = await freshDb(); await scene(db, 2)
  await updateSynthesis(db, 'i1', 'Prova', async input => ({ themes: [{ label: 'Tiri brevi', citations: citing(input, ['g0', 'g1']) }] }), NOW)
  await fileOne(db, 'g9', 'Tiri corti.')
  const checked: string[] = []
  const model = withCheck(
    async () => ({ themes: [{ label: 'Tiri brevi', citations: [{ reportId: 'g9', quote: 'Tiri corti' }] }] }),
    async input => {
      checked.push(...input.themes.flatMap(t => t.citations.map(c => `${t.label}: ${c.reportId}`)))
      return { themes: input.themes.map((t, i) => ({ from: i, label: t.label, reportIds: t.citations.map(c => c.reportId) })), flags: [] }
    },
  )
  await updateSynthesis(db, 'i1', 'Prova', model, new Date(NOW.getTime() + 1000))
  assert.deepEqual(checked, ['Tiri brevi: g9'])
  assert.equal((await synthesisFor(db, 'i1'))?.themes[0]?.count, 3)
})

// --- Merging the themes the first reading named twice ---------------------


const theme = (label: string, ids: string[]) =>
  ({ label, count: ids.length, reportIds: ids, quotes: Object.fromEntries(ids.map(id => [id, `parole di ${id}`])) })

test('applyMerges joins a group under the name kept, with every report of its members', () => {
  const out = applyMerges([
    theme('Chiodatura ravvicinata', ['g0', 'g1']), theme('Tiri brevi', ['g2']),
    theme('Chiodatura generosa', ['g1', 'g3']),
  ], [{ label: 'Chiodatura ravvicinata', themes: [0, 2] }])

  assert.deepEqual(out.map(t => [t.label, t.reportIds]), [
    ['Chiodatura ravvicinata', ['g0', 'g1', 'g3']], ['Tiri brevi', ['g2']],
  ], 'where its first member stood; a report in both counted once')
  assert.equal(out[0]?.quotes?.g1, 'parole di g1', 'a report keeps the quote it had first')
  assert.equal(out[0]?.count, 3)
})

test('applyMerges keeps a name of the group\'s own, never one the step made up', () => {
  const out = applyMerges([theme('Avvicinamento breve', ['g0', 'g1']), theme('Comoda da raggiungere', ['g2'])],
    [{ label: 'Accesso facile', themes: [0, 1] }])
  assert.deepEqual(out.map(t => t.label), ['Avvicinamento breve'], 'the best-supported member\'s instead')
})

test('applyMerges ignores what refers to nothing: out of range, already taken, alone', () => {
  const themes = [theme('A', ['g0']), theme('B', ['g1']), theme('C', ['g2'])]
  const out = applyMerges(themes, [
    { label: 'A', themes: [0, 7] },       // 7 was never shown: A alone, no merge
    { label: 'B', themes: [1, 2] },
    { label: 'C', themes: [2, 0] },       // 2 is taken: 0 alone, no merge
    { label: 'A', themes: [-1, 1.5] },
  ])
  assert.deepEqual(out.map(t => [t.label, t.reportIds]), [['A', ['g0']], ['B', ['g1', 'g2']]])
})

/** A model whose first reading is `read`, then `merge`, then `check`. */
const withMerge = (read: CallModel, merge: MergeThemes, check?: NonNullable<CallModel['check']>): CallModel =>
  Object.assign(async (input: CallModelInput) => read(input), { merge, ...(check ? { check } : {}) })

test('the merge step sees each theme with a few of its quotes, and its groups become one theme before the check', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const shown: string[][] = []
  const checked: string[] = []
  const model = withMerge(
    async input => ({ themes: [
      { label: 'Chiodatura ravvicinata', citations: citing(input, ['g0', 'g1', 'g2', 'g3']) },
      { label: 'Tiri brevi', citations: citing(input, ['g4']) },
      { label: 'Chiodatura generosa', citations: citing(input, ['g3', 'g4']) },
    ] }),
    async input => {
      shown.push(...input.themes.map(t => [t.label, ...t.quotes]))
      return { groups: [{ label: 'Chiodatura ravvicinata', themes: [0, 2] }] }
    },
    async input => {
      checked.push(...input.themes.map(t => `${t.label}: ${t.citations.length}`))
      return { themes: input.themes.map((t, from) => ({ from, label: t.label, reportIds: t.citations.map(c => c.reportId) })), flags: [] }
    },
  )

  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)

  assert.equal(shown[0]!.length, 1 + QUOTES_FOR_MERGE, 'a name and at most three quotes')
  assert.deepEqual(checked, ['Chiodatura ravvicinata: 5', 'Tiri brevi: 1'], 'the check reads the merged theme')
  const themes = (await synthesisFor(db, 'i1'))?.themes ?? []
  assert.deepEqual(themes.map(t => [t.label, t.count]), [['Chiodatura ravvicinata', 5], ['Tiri brevi', 1]])
  assert.equal((await synthesisFor(db, 'i1'))?.reading, READING)
})

test('a merge that fails leaves the themes apart and the reading goes on', async () => {
  const db = await freshDb(); await scene(db, EVIDENCE_FLOOR)
  const model = withMerge(
    async input => ({ themes: [
      { label: 'Avvicinamento breve', citations: citing(input, ['g0', 'g1']) },
      { label: 'Comoda da raggiungere', citations: citing(input, ['g2']) },
    ] }),
    async () => { throw new Error('rate limited') },
  )
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { errors.push(args) }
  try {
    await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)
  } finally { console.error = original }

  const themes = (await synthesisFor(db, 'i1'))?.themes ?? []
  assert.deepEqual(themes.map(t => t.label).sort(), ['Avvicinamento breve', 'Comoda da raggiungere'])
  assert.equal(errors.length, 1, 'and says so')
})

test('a single theme is not sent to be merged', async () => {
  const db = await freshDb(); await scene(db, 1)
  let asked = 0
  const model = withMerge(
    async input => ({ themes: [{ label: 'Tiri brevi', citations: citing(input, ['g0']) }] }),
    async () => { asked++; return { groups: [] } },
  )
  await regenerateSynthesis(db, 'i1', 'Prova', model, NOW)
  assert.equal(asked, 0)
})
