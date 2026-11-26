import type { ReadingStep } from '../../src/app/synthesis.ts'
import { PRICES_AS_OF } from '../prices.ts'
import { STEPS } from './eval.ts'
import { addCounts, emptyCounts, rates, type Counts, type Details, type Rates } from './score.ts'

/**
 * The results of an eval run, and the Markdown a person reads them in.
 * Pure: everything here is arithmetic over what `run.ts` measured.
 */

export interface RunResult {
  readonly counts: Record<ReadingStep, Counts>
  /** The last step's details: what the page would show. */
  readonly details: Details
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  readonly costUsd: number
  readonly unpriced: readonly string[]
  readonly models: readonly string[]
  readonly stepMs: Partial<Record<ReadingStep, number>>
  readonly wallMs: number
  readonly failed: boolean
  readonly errors: readonly string[]
}

export type CaseStatus = 'scored' | 'stale' | 'unrecorded'

export interface CaseResult {
  readonly id: string
  readonly source: string
  readonly name: string
  readonly activity: string
  readonly reports: number
  readonly status: CaseStatus
  readonly runs: readonly RunResult[]
}

/** What is kept as a baseline: rates, per step and per case, and the cost of a run. */
export interface Summary {
  readonly mode: 'replay' | 'live'
  readonly date: string
  readonly runs: number
  readonly steps: Record<ReadingStep, Rates>
  /** The final step's rates, run by run: how far apart repeated runs land. */
  readonly spread: { readonly min: Rates; readonly max: Rates } | null
  readonly costPerRunUsd: number
  readonly cases: Readonly<Record<string, Rates>>
}

export function summarize(cases: readonly CaseResult[], mode: Summary['mode'], date: string): Summary {
  const scored = cases.filter(c => c.status === 'scored')
  const runs = Math.max(0, ...scored.map(c => c.runs.length))
  const pooled = (step: ReadingStep, pick: (c: CaseResult) => readonly RunResult[]) =>
    rates(scored.flatMap(pick).reduce((a, r) => addCounts(a, r.counts[step]), emptyCounts()))
  const steps = Object.fromEntries(STEPS.map(s => [s, pooled(s, c => c.runs)])) as Record<ReadingStep, Rates>
  const perRun = Array.from({ length: runs }, (_, i) => pooled('check', c => c.runs.slice(i, i + 1)))
  const spread = runs > 1 ? { min: extreme(perRun, Math.min), max: extreme(perRun, Math.max) } : null
  const costPerRunUsd = runs === 0 ? 0
    : scored.reduce((a, c) => a + c.runs.reduce((b, r) => b + r.costUsd, 0) / c.runs.length, 0)
  return {
    mode, date, runs, steps, spread, costPerRunUsd,
    cases: Object.fromEntries(scored.map(c => [c.id,
      rates(c.runs.reduce((a, r) => addCounts(a, r.counts.check), emptyCounts()))])),
  }
}

function extreme(all: readonly Rates[], pick: (...n: number[]) => number): Rates {
  const out: Record<string, number | null> = {}
  for (const k of Object.keys(all[0]!) as (keyof Rates)[]) {
    const values = all.map(r => r[k]).filter((v): v is number => v !== null)
    out[k] = values.length === 0 ? null : pick(...values)
  }
  return out as unknown as Rates
}

/** Each measure: its name in the report, and whether more is better. */
const MEASURES: readonly { key: keyof Rates; name: string; higherIsBetter: boolean; percent: boolean }[] = [
  { key: 'sharedRecall', name: 'Shared themes found', higherIsBetter: true, percent: true },
  { key: 'loneRecall', name: 'One-report themes found', higherIsBetter: true, percent: true },
  { key: 'precision', name: 'Themes matching an expected one', higherIsBetter: true, percent: true },
  { key: 'countError', name: 'Count error per shared theme (reports)', higherIsBetter: false, percent: false },
  { key: 'splitRate', name: 'Shared themes split in two', higherIsBetter: false, percent: true },
  { key: 'bundleRate', name: 'Themes bundling two', higherIsBetter: false, percent: true },
  { key: 'leaks', name: 'Quotes from the weather or the crowd', higherIsBetter: false, percent: false },
  { key: 'labelIssueRate', name: 'Names breaking the prompt’s rules', higherIsBetter: false, percent: true },
  { key: 'flagRecall', name: 'Changes found', higherIsBetter: true, percent: true },
  { key: 'flagPrecision', name: 'Changes matching an expected one', higherIsBetter: true, percent: true },
  { key: 'flagKindAccuracy', name: 'Changes of the right kind', higherIsBetter: true, percent: true },
  { key: 'falseFlags', name: 'Changes read into no change', higherIsBetter: false, percent: false },
]

const show = (v: number | null, percent: boolean) =>
  v === null ? '—' : percent ? `${Math.round(v * 100)}%` : Number.isInteger(v) ? String(v) : v.toFixed(2)

function delta(now: number | null, then: number | null | undefined, m: (typeof MEASURES)[number]): string {
  if (now === null || then === null || then === undefined) return ''
  const d = now - then
  if (Math.abs(d) < 1e-9) return ' (=)'
  const better = m.higherIsBetter ? d > 0 : d < 0
  const size = m.percent ? `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pts` : `${d > 0 ? '+' : '−'}${show(Math.abs(d), false)}`
  return ` (${size} ${better ? '▲' : '▼'})`
}

const seconds = (ms: number | undefined) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`)
const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function markdown(cases: readonly CaseResult[], summary: Summary, baseline: Summary | null): string {
  const out: string[] = []
  const scored = cases.filter(c => c.status === 'scored')
  const models = [...new Set(scored.flatMap(c => c.runs.flatMap(r => r.models)))].sort()
  out.push('# Eval: reading reports into themes', '')
  out.push(`${summary.date} · ${summary.mode === 'live' ? 'live, against the API' : 'replayed from recordings'} · `
    + `${scored.length} of ${cases.length} cases scored · ${summary.runs} run${summary.runs === 1 ? '' : 's'} each`
    + (models.length ? ` · ${models.join(', ')}` : ''), '')
  if (baseline) out.push(`Compared with the baseline of ${baseline.date} (${baseline.mode}, ${baseline.runs} run${baseline.runs === 1 ? '' : 's'}): ▲ better, ▼ worse.`, '')

  const notScored = cases.filter(c => c.status !== 'scored')
  if (notScored.length > 0) {
    out.push('> **Not scored.** ' + notScored.map(c => `\`${c.id}\` (${c.status === 'stale'
      ? 'stale: a request changed since it was recorded' : 'never recorded'})`).join(', ')
      + '. Record them with `npm run eval -- --live`.', '')
  }
  const failed = scored.flatMap(c => c.runs.filter(r => r.failed).map(() => c.id))
  if (failed.length > 0) out.push(`> **Readings that failed** (scored as finding nothing): ${[...new Set(failed)].map(id => `\`${id}\``).join(', ')}.`, '')

  out.push('## Quality, step by step', '')
  out.push('Each step as it stands after the first reading (`read`), the merge (`merge`) and the check (`check`, what the page shows).'
    + (summary.spread ? ' The range is the lowest and highest of the repeated runs, final step.' : ''), '')
  out.push(`| Measure | read | merge | check${summary.spread ? ' | range' : ''} |`)
  out.push(`|---|---|---|---${summary.spread ? '|---' : ''}|`)
  for (const m of MEASURES) {
    const final = summary.steps.check[m.key]
    out.push(`| ${m.name} | ${show(summary.steps.read[m.key], m.percent)} | ${show(summary.steps.merge[m.key], m.percent)} | `
      + `**${show(final, m.percent)}**${delta(final, baseline?.steps.check[m.key], m)}`
      + (summary.spread ? ` | ${show(summary.spread.min[m.key], m.percent)}–${show(summary.spread.max[m.key], m.percent)}` : '') + ' |')
  }
  out.push('')

  out.push('## Cost and time', '')
  out.push(`Costs from the price list of ${PRICES_AS_OF} (\`evals/prices.ts\`), per run; times as measured when recorded.`, '')
  out.push('| Case | Reports | Calls | Tokens in / out | Cost | read | merge | check | Total |')
  out.push('|---|---|---|---|---|---|---|---|---|')
  for (const c of scored) {
    const r = c.runs
    const avg = (f: (x: RunResult) => number) => mean(r.map(f))
    const step = (s: ReadingStep) => seconds(r.every(x => x.stepMs[s] !== undefined) ? avg(x => x.stepMs[s]!) : undefined)
    out.push(`| \`${c.id}\` | ${c.reports} | ${Math.round(avg(x => x.calls))} | ${Math.round(avg(x => x.inputTokens)).toLocaleString('en')} / `
      + `${Math.round(avg(x => x.outputTokens)).toLocaleString('en')} | $${avg(x => x.costUsd).toFixed(4)} | ${step('read')} | ${step('merge')} | `
      + `${step('check')} | ${seconds(avg(x => x.wallMs))} |`)
  }
  const walls = scored.flatMap(c => c.runs.map(r => r.wallMs))
  out.push('', `A full run costs **$${summary.costPerRunUsd.toFixed(4)}**`
    + (baseline ? ` (baseline $${baseline.costPerRunUsd.toFixed(4)})` : '')
    + `. A case takes ${seconds(median(walls))} at the median, ${seconds(Math.max(0, ...walls))} at most.`, '')
  const unpriced = [...new Set(scored.flatMap(c => c.runs.flatMap(r => r.unpriced)))]
  if (unpriced.length) out.push(`> Not priced, so not in the totals: ${unpriced.join(', ')}.`, '')

  out.push('## Case by case', '')
  out.push('What the page would show after the check, on the last run. Labels are the case’s for what was expected, the reading’s for what it found.', '')
  for (const c of scored) {
    const r = summary.cases[c.id]!
    const last = c.runs[c.runs.length - 1]!
    const d = last.details
    out.push(`### \`${c.id}\` — ${c.name}`, '')
    out.push(`${c.activity}, ${c.reports} reports, ${c.source === 'demo' ? 'a demo place' : 'written as a trap'}. `
      + `Shared themes found ${show(r.sharedRecall, true)}, precision ${show(r.precision, true)}, changes found ${show(r.flagRecall, true)}.`, '')
    const list = (title: string, items: readonly string[]) => {
      if (items.length) out.push(`- **${title}:** ${items.join('; ')}`)
    }
    list('Missed shared themes', d.missedShared.map(m => `${cell(m.label)} (${m.reports})`))
    list('Split', d.splits.map(s => `${cell(s.expected)} → ${s.into.map(cell).join(' + ')}`))
    list('Bundled', d.bundles.map(b => `${cell(b.found)} ← ${b.of.map(cell).join(' + ')}`))
    list('Leaks', d.leaks.map(l => `${cell(l.label)}: «${cell(l.quote)}»`))
    list('Missed changes', d.missedFlags.map(f => `${cell(f.label)} (${f.kind})`))
    list('Wrong kind', d.wrongKind.map(w => `${cell(w.label)}: ${w.found}, not ${w.expected}`))
    list('Changes read into nothing', d.falseFlags.map(f => `${cell(f.label)}: «${cell(f.quote)}»`))
    list('Unexpected changes', d.unexpectedFlags.map(f => `${cell(f.label)} (${f.kind}): «${cell(f.quote)}»`))
    list('Names breaking the rules', d.labelIssues.map(l => `${cell(l.label)} (${l.why})`))
    list('Themes no expected one matches (read them: some may be right)', d.unexpected.map(u => `${cell(u.label)} (${u.reports}): «${cell(u.quote)}»`))
    const errors = [...new Set(c.runs.flatMap(x => x.errors))]
    list('Logged by the reading', errors.map(e => `\`${cell(e).slice(0, 200)}\``))
    out.push('')
  }
  return out.join('\n')
}
