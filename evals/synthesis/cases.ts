import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLAG_KINDS, type FlagKind } from '../../src/db/synthesis.ts'

/**
 * The cases the report reading is scored on, each a route's reports with what
 * a careful reader would draw from them, quote by quote.
 *
 * Two sources. `demo` cases are places of the public demo: their reports and,
 * beside each, the reading its writer planted (`readings` in the content file),
 * so nothing is written twice. `trap` cases are short routes written for the
 * evals alone, messier than the demo's: typos, dialect, irony, several ideas
 * to a sentence, opposites, the weather of the day, a change that is not one.
 * Every quote must be in its report character for character, or the case is
 * refused by name — a quote that is not in the words could never be matched,
 * and the miss would be blamed on the model.
 */

export interface Citation {
  readonly reportId: string
  readonly quote: string
}

/** A theme or a lasting change the reading should find: its name, and the words behind it. */
export interface Expected {
  readonly label: string
  readonly kind?: FlagKind
  readonly citations: readonly Citation[]
}

export interface CaseReport {
  readonly id: string
  readonly observedAt: string
  readonly words: string
}

export interface SynthesisCase {
  readonly id: string
  readonly source: 'demo' | 'trap'
  readonly itineraryName: string
  readonly activity: string
  /** Newest first, as the app reads them. */
  readonly reports: readonly CaseReport[]
  readonly themes: readonly Expected[]
  readonly flags: readonly Expected[]
  /** Words that must never back a theme: the weather that day, the crowd. */
  readonly notThemes: readonly Citation[]
  /** Words that must never back a change: how the route has always been. */
  readonly notFlags: readonly Citation[]
}

/** One report as a case file writes it, with what it says. */
export interface AnnotatedReport {
  readonly observedAt: string
  readonly words: string
  readonly themes?: readonly { label: string; quote: string }[]
  readonly flags?: readonly { label: string; kind: string; quote: string }[]
  readonly notThemes?: readonly string[]
  readonly notFlags?: readonly string[]
}

export interface TrapFile {
  readonly name: string
  readonly activity: string
  readonly reports: readonly AnnotatedReport[]
}

/** The list in `cases.json`: a demo place by its content file, or a trap file. */
type CaseEntry = { id: string; demo: string } | { id: string; trap: string }

/**
 * A case from annotated reports. Report ids are their place in the file
 * (`r1`…), so a case reads the same however often it is loaded; the reports
 * are then sent newest first, as `giteFor` returns them.
 */
export function buildCase(
  id: string, source: SynthesisCase['source'], itineraryName: string, activity: string,
  annotated: readonly AnnotatedReport[],
): SynthesisCase {
  const reports = annotated.map((r, i) => ({ id: `r${i + 1}`, observedAt: r.observedAt, words: r.words }))
  const themes = new Map<string, Citation[]>()
  const flags = new Map<string, { kind: FlagKind; citations: Citation[] }>()
  const notThemes: Citation[] = []
  const notFlags: Citation[] = []

  annotated.forEach((r, i) => {
    const reportId = `r${i + 1}`
    const cite = (quote: string, what: string): Citation => {
      if (quote.trim() === '' || !r.words.includes(quote)) {
        throw new Error(`eval case ${id}: report ${reportId}, ${what}: quote not in the words: «${quote}»`)
      }
      return { reportId, quote }
    }
    for (const t of r.themes ?? []) {
      const list = themes.get(t.label) ?? []
      if (!list.some(c => c.reportId === reportId)) list.push(cite(t.quote, `theme "${t.label}"`))
      themes.set(t.label, list)
    }
    for (const f of r.flags ?? []) {
      const kind = FLAG_KINDS.find(k => k === f.kind)
      if (!kind) throw new Error(`eval case ${id}: report ${reportId}, flag "${f.label}": no such kind "${f.kind}"`)
      const key = `${kind}\u0000${f.label}`
      const flag = flags.get(key) ?? { kind, citations: [] }
      flag.citations.push(cite(f.quote, `flag "${f.label}"`))
      flags.set(key, flag)
    }
    for (const q of r.notThemes ?? []) notThemes.push(cite(q, 'notThemes'))
    for (const q of r.notFlags ?? []) notFlags.push(cite(q, 'notFlags'))
  })

  const newestFirst = [...reports].sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
  return {
    id, source, itineraryName, activity,
    reports: newestFirst,
    themes: [...themes].map(([label, citations]) => ({ label, citations })),
    flags: [...flags].map(([key, f]) => ({ label: key.split('\u0000')[1]!, kind: f.kind, citations: f.citations })),
    notThemes, notFlags,
  }
}

interface DemoContent {
  readonly itinerary: { name?: string; activity?: string; reports?: readonly { observedAt: string; words: string }[] }
  readonly readings?: readonly ({ themes?: { label: string; quote: string }[]; flags?: { label: string; kind: string; quote: string }[] } | null)[]
}

/** A demo place as a case: its reports, each with the reading planted beside it. */
export function demoCase(id: string, content: DemoContent): SynthesisCase {
  const reports = content.itinerary.reports ?? []
  if (reports.length === 0) throw new Error(`eval case ${id}: the demo place has no reports`)
  return buildCase(id, 'demo', content.itinerary.name ?? id, content.itinerary.activity ?? '',
    reports.map((r, i) => ({ ...r, ...(content.readings?.[i] ?? {}) })))
}

/** Every case `evals/synthesis/cases.json` lists, read from the repository. */
export function loadCases(root: string): SynthesisCase[] {
  const here = join(root, 'evals', 'synthesis')
  const entries = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')) as CaseEntry[]
  return entries.map(e => {
    if ('demo' in e) {
      const file = join(root, 'src', 'seed', 'sets', 'demo', 'content', `${e.demo}.json`)
      return demoCase(e.id, JSON.parse(readFileSync(file, 'utf8')) as DemoContent)
    }
    const trap = JSON.parse(readFileSync(join(here, e.trap), 'utf8')) as TrapFile
    return buildCase(e.id, 'trap', trap.name, trap.activity, trap.reports)
  })
}
