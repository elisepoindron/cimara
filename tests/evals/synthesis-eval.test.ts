import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { CallModel } from '../../src/app/synthesis.ts'
import type { Flag, ThemeCount } from '../../src/db/synthesis.ts'
import { buildCase, loadCases, type AnnotatedReport, type SynthesisCase } from '../../evals/synthesis/cases.ts'
import { labelProblem, rates, scoreStep } from '../../evals/synthesis/score.ts'
import { runCase } from '../../evals/synthesis/eval.ts'
import { NotRecorded, recordingClient, replayingClient, requestKey, slim, type RecordedCall } from '../../evals/client.ts'
import { costOf } from '../../evals/prices.ts'
import { markdown, summarize, type CaseResult } from '../../evals/synthesis/report.ts'

const ROOT = join(import.meta.dirname, '..', '..')

/** Five reports about one crag: bolts far apart in three, good rock in two, one weather line. */
const REPORTS: AnnotatedReport[] = [
  { observedAt: '2026-05-01', words: 'Spit lontani sul 6b. Roccia ottima.', themes: [
    { label: 'Chiodatura lunga', quote: 'Spit lontani' }, { label: 'Roccia buona', quote: 'Roccia ottima' }] },
  { observedAt: '2026-04-01', words: 'Chiodatura lunga, roccia compatta.', themes: [
    { label: 'Chiodatura lunga', quote: 'Chiodatura lunga' }, { label: 'Roccia buona', quote: 'roccia compatta' }] },
  { observedAt: '2026-03-01', words: 'Faceva freddo. Uno spit ogni tre metri.', themes: [
    { label: 'Chiodatura lunga', quote: 'Uno spit ogni tre metri' }], notThemes: ['Faceva freddo.'] },
  { observedAt: '2026-02-01', words: 'Si è staccata una scaglia sul terzo tiro.', flags: [
    { label: 'Scaglia staccata', kind: 'attenzione', quote: 'Si è staccata una scaglia sul terzo tiro' }] },
  { observedAt: '2026-01-01', words: 'Vista sulla valle.', themes: [{ label: 'Vista', quote: 'Vista sulla valle' }] },
]

const CASE: SynthesisCase = buildCase('prova', 'trap', 'Prova', 'falesia', REPORTS)

/** A found theme: its name and, per report, the words it quotes. */
const theme = (label: string, quotes: Record<string, string>): ThemeCount =>
  ({ label, count: Object.keys(quotes).length, reportIds: Object.keys(quotes), quotes })
const flag = (label: string, kind: Flag['kind'], quotes: Record<string, string>): Flag =>
  ({ label, kind, reportIds: Object.keys(quotes), quotes })

const PERFECT = {
  themes: [
    theme('Spit distanti', { r1: 'Spit lontani sul 6b', r2: 'Chiodatura lunga', r3: 'Uno spit ogni tre metri' }),
    theme('Roccia buona', { r1: 'Roccia ottima', r2: 'roccia compatta' }),
    theme('Bella vista', { r5: 'Vista sulla valle' }),
  ],
  flags: [flag('Scaglia caduta', 'attenzione', { r4: 'staccata una scaglia' })],
}

test('a case gives its reports ids in file order and sends them newest first', () => {
  assert.deepEqual(CASE.reports.map(r => r.id), ['r1', 'r2', 'r3', 'r4', 'r5'])
  assert.deepEqual(CASE.themes.map(t => [t.label, t.citations.length]), [['Chiodatura lunga', 3], ['Roccia buona', 2], ['Vista', 1]])
  assert.equal(CASE.flags[0]?.kind, 'attenzione')
})

test('a case whose quote is not in its report is refused, by case, report and quote', () => {
  assert.throws(
    () => buildCase('rotto', 'trap', 'Rotto', 'falesia', [{ observedAt: '2026-01-01', words: 'Roccia ottima.',
      themes: [{ label: 'Roccia buona', quote: 'roccia ottima' }] }]),
    /eval case rotto: report r1, theme "Roccia buona": quote not in the words: «roccia ottima»/)
})

test('every case the evals list loads, every quote in its report', () => {
  const cases = loadCases(ROOT)
  assert.ok(cases.length >= 8)
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length, 'case ids are unique')
  for (const c of cases) assert.ok(c.themes.some(t => t.citations.length >= 2), `${c.id} has a shared theme`)
})

test('a reading that finds what the case says, in other names and longer quotes, scores full marks', () => {
  const r = rates(scoreStep(CASE, PERFECT).counts)
  assert.deepEqual(
    [r.sharedRecall, r.loneRecall, r.precision, r.countError, r.splitRate, r.bundleRate, r.leaks],
    [1, 1, 1, 0, 0, 0, 0])
  assert.deepEqual([r.flagRecall, r.flagPrecision, r.flagKindAccuracy, r.falseFlags], [1, 1, 1, 0])
})

test('a shared theme cut in two is a split, counted short, and the smaller half is unexpected', () => {
  const { counts, details } = scoreStep(CASE, { themes: [
    theme('Spit lontani', { r1: 'Spit lontani', r2: 'Chiodatura lunga' }),
    theme('Pochi spit', { r3: 'Uno spit ogni tre metri' }),
  ], flags: [] })
  assert.equal(counts.splits, 1)
  assert.deepEqual(details.splits, [{ expected: 'Chiodatura lunga', into: ['Spit lontani', 'Pochi spit'] }])
  assert.equal(counts.sharedFound, 1, 'the larger half still finds it')
  // Off by one on the bolts (2 for 3), and Roccia buona's two reports missed entirely.
  assert.equal(counts.countErrorSum, 1 + 2)
  assert.deepEqual(details.unexpected.map(u => u.label), ['Pochi spit'])
})

test('two themes of one report are told apart by their words, and one holding both is a bundle', () => {
  const apart = scoreStep(CASE, { themes: [theme('Roccia buona', { r1: 'Roccia ottima' })], flags: [] })
  assert.equal(apart.counts.outputMatched, 1)
  assert.equal(apart.details.bundles.length, 0, 'a quote about the rock is not a quote about the bolts')

  const both = scoreStep(CASE, { themes: [theme('Falesia bella', { r1: 'Spit lontani sul 6b. Roccia ottima.', r2: 'Chiodatura lunga, roccia compatta.' })], flags: [] })
  assert.deepEqual(both.details.bundles, [{ found: 'Falesia bella', of: ['Chiodatura lunga', 'Roccia buona'] }])
})

test('the other half of a sentence that makes one point agrees; a sentence making two does not', () => {
  const c = buildCase('frase', 'trap', 'Frase', 'falesia', [
    { observedAt: '2026-02-01', words: 'Il sentiero alto è stato riaperto: hanno messo una corda fissa. Bel posto.',
      flags: [{ label: 'Sentiero riaperto', kind: 'novita', quote: 'hanno messo una corda fissa' }] },
    { observedAt: '2026-01-01', words: 'Roccia bella ma spit lontani.', themes: [
      { label: 'Roccia buona', quote: 'Roccia bella' }, { label: 'Chiodatura lunga', quote: 'spit lontani' }] },
  ])
  const half = scoreStep(c, { themes: [], flags: [flag('Sentiero alto riaperto', 'novita', { r1: 'Il sentiero alto è stato riaperto' })] })
  assert.equal(half.counts.flagFound, 1)
  const other = scoreStep(c, { themes: [theme('Roccia ottima', { r2: 'Roccia bella ma spit lontani' })], flags: [] })
  assert.equal(other.counts.outputMatched, 1, 'its words overlap one point')
  const neither = scoreStep(c, { themes: [theme('Bella giornata', { r2: 'ma' })], flags: [flag('Bel posto', 'novita', { r1: 'Bel posto' })] })
  assert.equal(neither.counts.outputMatched, 0, 'a sentence with two points needs the words')
  assert.equal(neither.counts.flagOutputMatched, 0, 'another sentence is another point')
})

test('a theme quoting the weather is a leak, and a change quoting none is a false change', () => {
  const { counts, details } = scoreStep(
    { ...CASE, notFlags: [{ reportId: 'r3', quote: 'Faceva freddo.' }] },
    { themes: [theme('Falesia fredda', { r3: 'Faceva freddo' })], flags: [flag('Freddo', 'attenzione', { r3: 'Faceva freddo' })] })
  assert.equal(counts.leaks, 1)
  assert.deepEqual(details.leaks, [{ label: 'Falesia fredda', quote: 'Faceva freddo' }])
  assert.equal(counts.falseFlags, 1)
  assert.deepEqual(details.missedFlags, [{ label: 'Scaglia staccata', kind: 'attenzione' }])
})

test('a change found under the other kind is found, and counted as the wrong kind', () => {
  const { counts, details } = scoreStep(CASE, { themes: [], flags: [flag('Scaglia', 'novita', { r4: 'una scaglia' })] })
  assert.equal(counts.flagFound, 1)
  assert.equal(counts.flagKindRight, 0)
  assert.deepEqual(details.wrongKind, [{ label: 'Scaglia staccata', expected: 'attenzione', found: 'novita' }])
})

test('a name is held to the prompt: one idea, a few words', () => {
  assert.equal(labelProblem('Chiodatura ravvicinata'), null)
  assert.equal(labelProblem('Falesia è bella'), null, 'è is a verb, not a join')
  assert.equal(labelProblem('Roccia buona e tiri corti'), 'joins two ideas with "e"')
  assert.equal(labelProblem('Una falesia molto bella con tanta ombra'), '7 words')
})

test('a replayed run answers what was recorded, and a request it never saw fails and is listed', async () => {
  const params = { model: 'claude-haiku-5-5', system: 'x', messages: [{ role: 'user', content: 'y' }] }
  const message = slim({ model: 'claude-haiku-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking' }, { type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 2 } })
  assert.deepEqual(message.content, [{ type: 'text', text: '{}' }], 'thinking is not kept')
  const calls: RecordedCall[] = [{ key: requestKey(params), step: 'read', model: 'claude-haiku-5-5', latencyMs: 5, message }]
  const misses: string[] = []
  const client = replayingClient(calls, misses) as unknown as {
    messages: { stream: (p: unknown) => { finalMessage: () => Promise<unknown> } }
  }
  assert.deepEqual(await client.messages.stream(params).finalMessage(), message)
  await assert.rejects(client.messages.stream({ ...params, system: 'x, edited' }).finalMessage(), NotRecorded)
  assert.equal(misses.length, 1)
})

test('a recording client passes each call through, timed, under the step running, by the key replay looks it up by', async () => {
  const answer = { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"groups":[]}' }],
    usage: { input_tokens: 7, output_tokens: 3 } }
  const real = { messages: {}, beta: { messages: { stream: () => ({ finalMessage: async () => answer }) } } }
  const calls: RecordedCall[] = []
  const client = recordingClient(real as never, c => calls.push(c), () => 'merge') as unknown as {
    beta: { messages: { stream: (p: unknown) => { finalMessage: () => Promise<{ content: unknown }> } } }
  }
  const params = { model: 'claude-sonnet-5-5', betas: ['x'] }
  assert.deepEqual((await client.beta.messages.stream(params).finalMessage()).content, answer.content)
  assert.deepEqual(calls.map(c => [c.step, c.key, c.model]), [['merge', requestKey(params), 'claude-sonnet-5-5']])
})

test('a case runs through the app’s own reading, each step observed, failures kept beside it', async () => {
  const quoting: CallModel = async input => ({
    themes: [{ label: 'Chiodatura lunga', citations: input.reports.slice(0, 3).map(r => ({ reportId: r.id, quote: r.words })) }],
  })
  const run = await runCase(CASE, quoting)
  assert.equal(run.failed, false)
  assert.deepEqual(run.steps.check?.themes.map(t => t.reportIds), [['r1', 'r2', 'r3']])
  assert.ok(run.stepMs.read !== undefined)

  const broken = await runCase(CASE, async () => { throw new Error('rate limited') })
  assert.equal(broken.failed, true)
  assert.ok(broken.errors.some(e => e.includes('rate limited')))
})

test('a call is priced from the table, and a model it does not know is not priced', () => {
  assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), 2 + 1)
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 }), 0.10, 'past 100k the long price')
  assert.equal(costOf('some-other-model', { input_tokens: 1, output_tokens: 1 }), null)
})

test('the report says what was not scored, and compares with a baseline in the right direction', () => {
  const scored = scoreStep(CASE, PERFECT)
  const run = {
    counts: { read: scored.counts, merge: scored.counts, check: scored.counts }, details: scored.details,
    calls: 3, inputTokens: 1000, outputTokens: 100, cacheTokens: 0, costUsd: 0.01, unpriced: [], models: ['claude-haiku-5-5'],
    stepMs: { read: 1000, merge: 200, check: 300 }, wallMs: 1500, failed: false, errors: [],
  }
  const cases: CaseResult[] = [
    { id: 'prova', source: 'trap', name: 'Prova', activity: 'falesia', reports: 5, status: 'scored', runs: [run] },
    { id: 'vecchio', source: 'demo', name: 'Vecchio', activity: 'falesia', reports: 3, status: 'stale', runs: [] },
  ]
  const summary = summarize(cases, 'replay', '2026-11-26')
  const worse = { ...summary, steps: { ...summary.steps, check: { ...summary.steps.check, sharedRecall: 0.5 } } }
  const md = markdown(cases, summary, worse)
  assert.match(md, /`vecchio` \(stale/)
  assert.match(md, /\| Shared themes found \| 100% \| 100% \| \*\*100%\*\* \(\+50 pts ▲\) \|/)
  assert.equal(summary.costPerRunUsd, 0.01)
})
