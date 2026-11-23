import { ACTIVITIES } from './activities/index.ts'
import { chartSteps } from './quantity.ts'
import type { FactDef } from './registry.ts'
import type { GradeSystem } from './find/constraints.ts'

/** One scale as the Info page states it: its steps, and who grades with it. */
export interface ScaleInUse {
  readonly system: GradeSystem
  readonly steps: readonly string[]
  /** The activities whose facts or parts are graded on it, in registry order. */
  readonly activities: readonly string[]
}

const SYSTEMS: readonly GradeSystem[] = ['alpine', 'sport']

/**
 * The scale a fact is graded on, read from its quantity's kind: a grade is
 * `grade:sport`, a span of grades `range:grade:sport`. Anything else is not
 * graded — a free-text "Difficoltà" says what a contributor wrote, not a step.
 */
function systemOf(f: FactDef): GradeSystem | null {
  const m = /(?:^|:)grade:(alpine|sport)$/.exec(f.quantity.kind)
  return m ? (m[1] as GradeSystem) : null
}

/**
 * Every grade scale the archive holds, with the activities that use it.
 *
 * Read from the registry rather than written down, so the Info page never
 * explains a scale nothing is graded on, and an activity that starts grading on
 * one appears beside it with no edit here. A scale no activity uses is left out.
 * The steps are the chart's, a plus counted with its letter.
 */
export function scalesInUse(): readonly ScaleInUse[] {
  const users = new Map<GradeSystem, string[]>(SYSTEMS.map(s => [s, []]))
  for (const a of Object.values(ACTIVITIES)) {
    const facts = [...a.facts, ...(a.parts?.fields ?? [])]
    const used = new Set(facts.map(systemOf).filter((s): s is GradeSystem => s !== null))
    for (const s of used) users.get(s)!.push(a.label.it)
  }
  return SYSTEMS
    .map(system => ({ system, steps: chartSteps(system), activities: users.get(system)! }))
    .filter(s => s.activities.length > 0)
}
