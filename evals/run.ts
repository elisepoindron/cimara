/**
 * `npm run eval`: scores the report reading on fixed cases and writes what it
 * found to `evals/out/` — `synthesis.md` to read, `synthesis.json` to keep.
 *
 *   npm run eval                          replays the recordings: no key, no network
 *   npm run eval -- --live                asks the API, records its answers, prints the cost
 *   npm run eval -- --live --repeat 3     three runs a case, to see how far apart they land
 *   npm run eval -- --live --case <id>    records one case again, replays the rest
 *   npm run eval -- --save-baseline       keeps this run as the one later runs compare with
 *
 * Replay checks the scoring and everything the app does after the model; only
 * a live run measures the model. A case whose requests changed since it was
 * recorded (a prompt edited, a model swapped) is not scored, and the run says so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { callModelWith, type ModelClient } from '../src/app/ai-client.ts'
import type { ReadingStep } from '../src/app/synthesis.ts'
import { recordingClient, replayingClient, type RecordedCall } from './client.ts'
import { costOf } from './prices.ts'
import { loadCases, type SynthesisCase } from './synthesis/cases.ts'
import { runCase, STEPS, type CaseRun } from './synthesis/eval.ts'
import { markdown, summarize, type CaseResult, type RunResult, type Summary } from './synthesis/report.ts'
import { scoreStep, type Counts } from './synthesis/score.ts'

const ROOT = join(import.meta.dirname, '..')
const CASSETTES = join(ROOT, 'evals', 'cassettes', 'synthesis')
const OUT = join(ROOT, 'evals', 'out')
const BASELINE = join(ROOT, 'evals', 'synthesis', 'baseline.json')

interface Cassette {
  readonly case: string
  readonly recordedAt: string
  readonly runs: readonly { calls: readonly RecordedCall[]; stepMs: CaseRun['stepMs']; wallMs: number }[]
}

interface Options { live: boolean; repeat: number; cases: string[]; saveBaseline: boolean }

function options(argv: readonly string[]): Options {
  const o: Options = { live: false, repeat: 1, cases: [], saveBaseline: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--live') o.live = true
    else if (a === '--save-baseline') o.saveBaseline = true
    else if (a === '--repeat') o.repeat = Number(argv[++i])
    else if (a === '--case') o.cases.push(argv[++i] ?? '')
    else throw new Error(`eval: unknown option ${a}`)
  }
  if (!Number.isInteger(o.repeat) || o.repeat < 1) throw new Error('eval: --repeat takes a whole number, 1 or more')
  return o
}

const cassetteFile = (id: string) => join(CASSETTES, `${id}.json`)

/** One run's score at every step, its cost and its time, from what it read and the calls it made. */
function result(c: SynthesisCase, run: CaseRun, calls: readonly RecordedCall[]): RunResult {
  const counts = {} as Record<ReadingStep, Counts>
  const empty = { themes: [], flags: [] }
  for (const s of STEPS) counts[s] = run.failed ? scoreStep(c, empty).counts : scoreStep(c, run.steps[s] ?? empty).counts
  const unpriced = new Set<string>()
  let costUsd = 0
  for (const call of calls) {
    const cost = costOf(call.message.model, call.message.usage)
    if (cost === null) unpriced.add(call.message.model)
    else costUsd += cost
  }
  const u = calls.map(x => x.message.usage)
  return {
    counts,
    details: scoreStep(c, run.failed ? empty : run.steps.check ?? empty).details,
    calls: calls.length,
    inputTokens: u.reduce((a, x) => a + x.input_tokens, 0),
    outputTokens: u.reduce((a, x) => a + x.output_tokens, 0),
    cacheTokens: u.reduce((a, x) => a + (x.cache_creation_input_tokens ?? 0) + (x.cache_read_input_tokens ?? 0), 0),
    costUsd, unpriced: [...unpriced],
    models: [...new Set(calls.map(x => x.message.model))],
    stepMs: run.stepMs, wallMs: run.wallMs, failed: run.failed, errors: run.errors,
  }
}

async function liveCase(c: SynthesisCase, real: ModelClient, repeat: number): Promise<CaseResult> {
  const runs: RunResult[] = []
  const recorded: Cassette['runs'][number][] = []
  for (let i = 0; i < repeat; i++) {
    const calls: RecordedCall[] = []
    let step: ReadingStep = 'read'
    const client = recordingClient(real, call => calls.push(call), () => step)
    process.stdout.write(`  ${c.id}${repeat > 1 ? ` (run ${i + 1}/${repeat})` : ''}… `)
    const run = await runCase(c, callModelWith(client), s => { step = s })
    const r = result(c, run, calls)
    console.log(`${r.calls} calls, $${r.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)} s${run.failed ? ', FAILED' : ''}`)
    runs.push(r)
    recorded.push({ calls, stepMs: run.stepMs, wallMs: run.wallMs })
  }
  const cassette: Cassette = { case: c.id, recordedAt: new Date().toISOString(), runs: recorded }
  writeFileSync(cassetteFile(c.id), JSON.stringify(cassette, null, 1) + '\n')
  return caseResult(c, 'scored', runs)
}

async function replayCase(c: SynthesisCase): Promise<CaseResult> {
  if (!existsSync(cassetteFile(c.id))) return caseResult(c, 'unrecorded', [])
  const cassette = JSON.parse(readFileSync(cassetteFile(c.id), 'utf8')) as Cassette
  const runs: RunResult[] = []
  for (const rec of cassette.runs) {
    const misses: string[] = []
    const run = await runCase(c, callModelWith(replayingClient(rec.calls, misses)))
    if (misses.length > 0) return caseResult(c, 'stale', [])
    // The times are the recording's: a replay takes none worth reporting.
    runs.push(result(c, { ...run, stepMs: rec.stepMs, wallMs: rec.wallMs }, rec.calls))
  }
  return caseResult(c, 'scored', runs)
}

function caseResult(c: SynthesisCase, status: CaseResult['status'], runs: RunResult[]): CaseResult {
  return { id: c.id, source: c.source, name: c.itineraryName, activity: c.activity, reports: c.reports.length, status, runs }
}

async function main(): Promise<void> {
  const o = options(process.argv.slice(2))
  const cases = loadCases(ROOT)
  const unknown = o.cases.filter(id => !cases.some(c => c.id === id))
  if (unknown.length) throw new Error(`eval: no case named ${unknown.join(', ')}`)
  const live = new Set(o.live ? (o.cases.length ? o.cases : cases.map(c => c.id)) : [])

  let real: ModelClient | null = null
  if (live.size > 0) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('eval: --live needs ANTHROPIC_API_KEY (in .env or the shell)')
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    real = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    mkdirSync(CASSETTES, { recursive: true })
    console.log(`Asking the API for ${live.size} case(s), ${o.repeat} run(s) each:`)
  }

  const results: CaseResult[] = []
  for (const c of cases) results.push(live.has(c.id) ? await liveCase(c, real!, o.repeat) : await replayCase(c))

  const date = new Date().toISOString().slice(0, 10)
  const summary = summarize(results, live.size > 0 ? 'live' : 'replay', date)
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Summary : null
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'synthesis.json'), JSON.stringify({ summary, cases: results }, null, 1) + '\n')
  writeFileSync(join(OUT, 'synthesis.md'), markdown(results, summary, o.saveBaseline ? null : baseline))
  if (o.saveBaseline) writeFileSync(BASELINE, JSON.stringify(summary, null, 1) + '\n')

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
  const s = summary.steps.check
  console.log(`\nShared themes found ${pct(s.sharedRecall)}, precision ${pct(s.precision)}, `
    + `changes found ${pct(s.flagRecall)}, leaks ${s.leaks}; a full run costs $${summary.costPerRunUsd.toFixed(4)}.`)
  console.log(`Report: evals/out/synthesis.md${o.saveBaseline ? ' · baseline saved to evals/synthesis/baseline.json' : ''}`)
  const notScored = results.filter(r => r.status !== 'scored')
  if (notScored.length > 0) {
    console.error(`Not scored: ${notScored.map(r => `${r.id} (${r.status})`).join(', ')}. Record them with --live.`)
    process.exitCode = 1
  }
}

await main()
