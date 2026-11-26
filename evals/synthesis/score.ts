import type { Flag, ThemeCount } from '../../src/db/synthesis.ts'
import type { Citation, Expected, SynthesisCase } from './cases.ts'

/**
 * Scores one step of a reading against a case. Pure: what the reading found
 * and the case go in, counts and the details behind them come out.
 *
 * A theme the reading found is matched to an expected one by the words it
 * cites, never by its name: the reading names "Spit lontani" what the case
 * calls "Chiodatura lunga", and both are right. Two citations agree when they
 * name the same report and their quotes overlap in its words, so two themes
 * drawn from one report ("tiri corti, roccia buona") stay apart.
 *
 * Counts, not rates, so cases and runs add up before anything is divided.
 */

/** An expected and a found group are one theme from this overlap of reports. */
export const MATCH_JACCARD = 0.5

/** A found group is "mostly" an expected one when this share of it is that one. */
export const MOSTLY = 0.5

/** What one step found: the groups as `readReports` hands them to `observe`. */
export interface Found {
  readonly themes: readonly ThemeCount[]
  readonly flags: readonly Flag[]
}

export interface Counts {
  /** Themes the case expects from two reports or more: the ones the page counts. */
  sharedExpected: number
  sharedFound: number
  /** Themes the case expects from one report. */
  loneExpected: number
  loneFound: number
  /** Themes the step returned, and how many of them match an expected one. */
  output: number
  outputMatched: number
  /** For each shared theme, how far the reports it is shown with are from the right number. */
  countErrorSum: number
  /** Shared themes the step cut in two or more. */
  splits: number
  /** Returned themes that hold two expected themes or more. */
  bundles: number
  /** Citations backing a theme with words that must back none (the weather, the crowd). */
  leaks: number
  /** Returned theme names that break the prompt's own rules. */
  labelIssues: number
  flagExpected: number
  flagFound: number
  flagOutput: number
  flagOutputMatched: number
  /** Matched changes whose kind (`attenzione`, `novita`) is the expected one. */
  flagKindRight: number
  /** Change citations backed by words that record no change. */
  falseFlags: number
}

export interface Details {
  readonly missedShared: readonly { label: string; reports: number }[]
  readonly unexpected: readonly { label: string; reports: number; quote: string }[]
  readonly splits: readonly { expected: string; into: readonly string[] }[]
  readonly bundles: readonly { found: string; of: readonly string[] }[]
  readonly leaks: readonly { label: string; quote: string }[]
  readonly labelIssues: readonly { label: string; why: string }[]
  readonly missedFlags: readonly { label: string; kind: string }[]
  readonly unexpectedFlags: readonly { label: string; kind: string; quote: string }[]
  readonly wrongKind: readonly { label: string; expected: string; found: string }[]
  readonly falseFlags: readonly { label: string; quote: string }[]
}

export function emptyCounts(): Counts {
  return {
    sharedExpected: 0, sharedFound: 0, loneExpected: 0, loneFound: 0, output: 0, outputMatched: 0,
    countErrorSum: 0, splits: 0, bundles: 0, leaks: 0, labelIssues: 0,
    flagExpected: 0, flagFound: 0, flagOutput: 0, flagOutputMatched: 0, flagKindRight: 0, falseFlags: 0,
  }
}

export function addCounts(a: Counts, b: Counts): Counts {
  const out = { ...a }
  for (const k of Object.keys(b) as (keyof Counts)[]) out[k] += b[k]
  return out
}

/** A found group, read the same way whether it is a theme or a change. */
interface Group {
  readonly label: string
  readonly kind?: string
  readonly quotes: Readonly<Record<string, string>>
}

type Span = readonly [number, number]

export function scoreStep(c: SynthesisCase, found: Found): { counts: Counts; details: Details } {
  const words = new Map(c.reports.map(r => [r.id, r.words]))
  const spanOf = (reportId: string, quote: string): Span | null => {
    const at = words.get(reportId)?.indexOf(quote.trim()) ?? -1
    return at < 0 ? null : [at, at + quote.trim().length]
  }
  const overlaps = (a: Span | null, b: Span | null) => a !== null && b !== null && a[0] < b[1] && b[0] < a[1]
  /** How many of `e`'s citations `g` cites too, in overlapping words. */
  const shared = (e: Expected, g: Group) => e.citations.filter(ci => {
    const q = g.quotes[ci.reportId]
    return q !== undefined && overlaps(spanOf(ci.reportId, ci.quote), spanOf(ci.reportId, q))
  }).length
  const size = (g: Group) => Object.keys(g.quotes).length

  const themes: Group[] = found.themes.map(t => ({ label: t.label, quotes: t.quotes ?? {} })).filter(g => size(g) > 0)
  const flags: Group[] = found.flags.map(f => ({ label: f.label, kind: f.kind, quotes: f.quotes })).filter(g => size(g) > 0)

  const themeMatch = match(c.themes, themes, shared, size)
  const flagMatch = match(c.flags, flags, shared, size)
  const counts = emptyCounts()
  const isShared = (e: Expected) => e.citations.length >= 2

  // Themes.
  const missedShared: { label: string; reports: number }[] = []
  for (const [i, e] of c.themes.entries()) {
    const j = themeMatch.byExpected.get(i)
    if (isShared(e)) {
      counts.sharedExpected++
      if (j !== undefined) counts.sharedFound++
      else missedShared.push({ label: e.label, reports: e.citations.length })
      counts.countErrorSum += j !== undefined ? Math.abs(size(themes[j]!) - e.citations.length) : e.citations.length
    } else {
      counts.loneExpected++
      if (j !== undefined) counts.loneFound++
    }
  }
  counts.output = themes.length
  counts.outputMatched = themeMatch.byFound.size
  const unexpected = themes.flatMap((g, j) => themeMatch.byFound.has(j) ? []
    : [{ label: g.label, reports: size(g), quote: Object.values(g.quotes)[0] ?? '' }])

  const splits = c.themes.flatMap(e => {
    if (!isShared(e)) return []
    const parts = themes.filter(g => { const k = shared(e, g); return k >= 1 && k / size(g) >= MOSTLY })
    return parts.length >= 2 ? [{ expected: e.label, into: parts.map(g => g.label) }] : []
  })
  counts.splits = splits.length
  const bundles = themes.flatMap(g => {
    const of = c.themes.filter(e => { const k = shared(e, g); return k >= 1 && k / e.citations.length >= MOSTLY })
    return of.length >= 2 ? [{ found: g.label, of: of.map(e => e.label) }] : []
  })
  counts.bundles = bundles.length

  const touches = (forbidden: readonly Citation[], g: Group) => Object.entries(g.quotes).flatMap(([reportId, q]) =>
    forbidden.some(f => f.reportId === reportId && overlaps(spanOf(reportId, f.quote), spanOf(reportId, q)))
      ? [{ label: g.label, quote: q }] : [])
  const leaks = themes.flatMap(g => touches(c.notThemes, g))
  counts.leaks = leaks.length

  const labelIssues = themes.flatMap(g => {
    const why = labelProblem(g.label)
    return why ? [{ label: g.label, why }] : []
  })
  counts.labelIssues = labelIssues.length

  // Lasting changes.
  counts.flagExpected = c.flags.length
  counts.flagFound = flagMatch.byExpected.size
  counts.flagOutput = flags.length
  counts.flagOutputMatched = flagMatch.byFound.size
  const wrongKind: { label: string; expected: string; found: string }[] = []
  for (const [i, j] of flagMatch.byExpected) {
    const e = c.flags[i]!, g = flags[j]!
    if (g.kind === e.kind) counts.flagKindRight++
    else wrongKind.push({ label: e.label, expected: e.kind ?? '', found: g.kind ?? '' })
  }
  const falseFlags = flags.flatMap(g => touches(c.notFlags, g))
  counts.falseFlags = falseFlags.length

  return {
    counts,
    details: {
      missedShared, unexpected, splits, bundles, leaks, labelIssues,
      missedFlags: c.flags.flatMap((e, i) => flagMatch.byExpected.has(i) ? [] : [{ label: e.label, kind: e.kind ?? '' }]),
      unexpectedFlags: flags.flatMap((g, j) => flagMatch.byFound.has(j) ? []
        : [{ label: g.label, kind: g.kind ?? '', quote: Object.values(g.quotes)[0] ?? '' }]),
      wrongKind, falseFlags,
    },
  }
}

/**
 * Expected groups to found ones, one to one: the closest pairs first, by the
 * share of reports they have in common, and none below `MATCH_JACCARD`.
 */
function match(
  expected: readonly Expected[], found: readonly Group[],
  shared: (e: Expected, g: Group) => number, size: (g: Group) => number,
): { byExpected: Map<number, number>; byFound: Map<number, number> } {
  const pairs: { i: number; j: number; jaccard: number }[] = []
  expected.forEach((e, i) => found.forEach((g, j) => {
    const k = shared(e, g)
    if (k === 0) return
    const jaccard = k / (e.citations.length + size(g) - k)
    if (jaccard >= MATCH_JACCARD) pairs.push({ i, j, jaccard })
  }))
  pairs.sort((a, b) => b.jaccard - a.jaccard || a.i - b.i || a.j - b.j)
  const byExpected = new Map<number, number>()
  const byFound = new Map<number, number>()
  for (const p of pairs) {
    if (byExpected.has(p.i) || byFound.has(p.j)) continue
    byExpected.set(p.i, p.j)
    byFound.set(p.j, p.i)
  }
  return { byExpected, byFound }
}

/**
 * What the prompt asks of a name, checked without a model: two to five words
 * (six allowed), one idea (no "e" joining two), short enough for the page.
 */
export function labelProblem(label: string): string | null {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'empty'
  if (words.length > 6) return `${words.length} words`
  if (label.length > 60) return `${label.length} characters`
  if (/\se\s/i.test(label)) return 'joins two ideas with "e"'
  return null
}

export interface Rates {
  readonly sharedRecall: number | null
  readonly loneRecall: number | null
  readonly precision: number | null
  readonly countError: number | null
  readonly splitRate: number | null
  readonly bundleRate: number | null
  readonly leaks: number
  readonly labelIssueRate: number | null
  readonly flagRecall: number | null
  readonly flagPrecision: number | null
  readonly flagKindAccuracy: number | null
  readonly falseFlags: number
}

export function rates(c: Counts): Rates {
  const div = (a: number, b: number) => (b === 0 ? null : a / b)
  return {
    sharedRecall: div(c.sharedFound, c.sharedExpected),
    loneRecall: div(c.loneFound, c.loneExpected),
    precision: div(c.outputMatched, c.output),
    countError: div(c.countErrorSum, c.sharedExpected),
    splitRate: div(c.splits, c.sharedExpected),
    bundleRate: div(c.bundles, c.output),
    leaks: c.leaks,
    labelIssueRate: div(c.labelIssues, c.output),
    flagRecall: div(c.flagFound, c.flagExpected),
    flagPrecision: div(c.flagOutputMatched, c.flagOutput),
    flagKindAccuracy: div(c.flagKindRight, c.flagFound),
    falseFlags: c.falseFlags,
  }
}
