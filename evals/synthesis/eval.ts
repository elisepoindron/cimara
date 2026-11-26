import { readReports, type CallModel, type ReadingStep } from '../../src/app/synthesis.ts'
import type { GitaRow } from '../../src/db/gita.ts'
import type { SynthesisCase } from './cases.ts'
import type { Found } from './score.ts'

/**
 * One case read once, through the app's own `readReports`: what stood after
 * each step, how long each step took, and what went wrong on the way.
 */
export interface CaseRun {
  readonly steps: Partial<Record<ReadingStep, Found>>
  readonly stepMs: Partial<Record<ReadingStep, number>>
  readonly wallMs: number
  /** The reading returned nothing: a call failed and the page would keep what it had. */
  readonly failed: boolean
  /** What the reading logged as it failed or read on without a step. */
  readonly errors: readonly string[]
}

export const STEPS: readonly ReadingStep[] = ['read', 'merge', 'check']

/**
 * Reads the case's reports as a route read from scratch, with no theme yet.
 * `onStep` is told when each step starts, so a recording client can file every
 * call under its step. The reading logs its failures with `console.error`;
 * they are kept here instead, beside the case they belong to.
 */
export async function runCase(
  c: SynthesisCase, callModel: CallModel, onStep: (step: ReadingStep) => void = () => {},
): Promise<CaseRun> {
  const stepMs: Partial<Record<ReadingStep, number>> = {}
  const timed = <I, O>(step: ReadingStep, f: (input: I) => Promise<O>) => async (input: I): Promise<O> => {
    onStep(step)
    const started = performance.now()
    try {
      return await f(input)
    } finally {
      stepMs[step] = Math.round(performance.now() - started)
    }
  }
  const model: CallModel = Object.assign(timed('read', callModel), {
    ...(callModel.merge ? { merge: timed('merge', callModel.merge) } : {}),
    ...(callModel.check ? { check: timed('check', callModel.check) } : {}),
  })

  const gite: GitaRow[] = c.reports.map(r => ({
    id: r.id, itineraryId: c.id, accountId: null, authorName: null,
    observedAt: r.observedAt, filedAt: r.observedAt, words: r.words,
  }))
  const steps: Partial<Record<ReadingStep, Found>> = {}
  const errors: string[] = []
  const logged = console.error
  console.error = (...args: unknown[]) => { errors.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')) }
  const started = performance.now()
  let result
  try {
    result = await readReports(c.itineraryName, gite, model,
      { themes: [], flags: [], previousLabels: [], previousFlags: [] },
      (step, found) => { steps[step] = found })
  } finally {
    console.error = logged
  }
  return { steps, stepMs, wallMs: Math.round(performance.now() - started), failed: result === null, errors }
}
