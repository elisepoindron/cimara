import type { ActivitySchema, RowIcon } from './registry.ts'
import { distributionOf, readFact, type Part, type StoredFacts } from './facts.ts'
import { chartStep, chartSteps, type Aspect, type Ordered } from './quantity.ts'
import type { GradeSystem } from './find/constraints.ts'

export interface GradeCount {
  readonly ordinal: number
  readonly grade: string
  readonly n: number
}

/** One cell of a row's facts line, with everything its renderer needs and nothing to look up. */
export type RowCell =
  | { readonly kind: 'fact'; readonly icon: RowIcon; readonly label: string; readonly text: string
      readonly aspect: Aspect | null }
  | { readonly kind: 'histogram'; readonly scale: GradeSystem; readonly counts: readonly GradeCount[]
      readonly total: number; readonly each: string; readonly many: string }
  | { readonly kind: 'distance'; readonly km: number }
  | { readonly kind: 'grades'; readonly label: string
      readonly grades: readonly { readonly it: string; readonly grade: string }[] }

/**
 * A declared item's cell, or null where there is nothing to show. Null rather
 * than absent, so a Find list keeps every fact in its own column: a crag whose
 * grades cannot be read leaves the histogram's column empty instead of sliding
 * its vie count under it.
 */
export type RowSlot = RowCell | null

/**
 * The chart steps one list's histograms share, lowest to highest, every step
 * between — a plus counted with its letter, as on the crag page (`chartSteps`).
 */
export interface GradeAxis {
  readonly scale: GradeSystem
  readonly grades: readonly string[]
}

/** One bar of a row's histogram: its chart step, its place on the axis and how many. */
export interface GradeBar {
  readonly grade: string
  readonly at: number
  readonly n: number
}

function histogramCell(schema: ActivitySchema, field: string, parts: readonly Part[]): RowCell | null {
  const def = schema.parts?.fields.find(f => f.id === field)
  if (!def || !schema.parts) return null
  const scale = def.quantity as Ordered<string>
  const counts = distributionOf(schema, parts, field)
    .map(d => ({ ordinal: scale.ordinal(d.value), grade: d.value, n: d.n }))
  if (counts.length === 0) return null

  return {
    kind: 'histogram',
    scale: def.quantity.kind.replace('grade:', '') as GradeSystem,
    counts,
    total: counts.reduce((sum, c) => sum + c.n, 0),
    each: schema.parts.each.it,
    many: schema.parts.label.it.toLowerCase(),
  }
}

/**
 * The facts line of one row: a slot per item the activity's `row` declares.
 * Values are written by their own quantity, so "20 min", "2000 m" and "Sud-Est"
 * come from the code that writes them on the route page.
 */
export function rowCellsOf(
  schema: ActivitySchema, stored: StoredFacts, parts: readonly Part[], km: number | null,
): RowSlot[] {
  return (schema.row ?? []).map((item): RowSlot => {
    if (item.kind === 'distance') return km === null ? null : { kind: 'distance', km }
    if (item.kind === 'histogram') return histogramCell(schema, item.field, parts)
    if (item.kind === 'grades') {
      // Each grade the route recorded, easier first; one alone is still said
      // with its word. The same grade twice is said once, as the harder.
      const read = [item.low, item.high].flatMap(g => {
        const def = schema.facts.find(f => f.id === g.fact)
        const value = def ? readFact(schema, def, stored, parts) : null
        return value && value.value !== null ? [{ it: g.it, grade: value.text }] : []
      })
      const grades = read.length === 2 && read[0]!.grade === read[1]!.grade ? [read[1]!] : read
      return grades.length === 0 ? null : { kind: 'grades', label: 'Difficoltà', grades }
    }

    const def = schema.facts.find(f => f.id === item.fact)
    const value = def ? readFact(schema, def, stored, parts) : null
    if (!def || !value) return null
    return {
      kind: 'fact', icon: item.icon, label: def.label.it, text: value.text,
      aspect: def.quantity.kind === 'aspect' ? (value.value as Aspect) : null,
    }
  })
}

/**
 * One axis for every histogram in a list, from its lowest grade to its highest.
 * Shared so rows compare by where their bars sit rather than by their shapes.
 * Null when the list holds no histogram.
 */
export function axisOf(rows: readonly (readonly RowSlot[])[]): GradeAxis | null {
  const histograms = rows.flat()
    .filter((c): c is Extract<RowCell, { kind: 'histogram' }> => c?.kind === 'histogram')
  if (histograms.length === 0) return null

  const scale = histograms[0]!.scale
  const steps = chartSteps(scale)
  const at = histograms.filter(h => h.scale === scale)
    .flatMap(h => h.counts.map(c => steps.indexOf(chartStep(scale, c.grade))))
  return { scale, grades: steps.slice(Math.min(...at), Math.max(...at) + 1) }
}

/**
 * The bars a row's histogram draws on the list's axis: its counts folded into
 * chart steps, so a crag's 6a and 6a+ make one bar. The cell keeps the grades
 * as written, for whatever reads its exact range.
 */
export function barsOn(cell: Extract<RowCell, { kind: 'histogram' }>, axis: GradeAxis): GradeBar[] {
  const bars = new Map<string, GradeBar>()
  for (const c of cell.counts) {
    const grade = chartStep(axis.scale, c.grade)
    const had = bars.get(grade)
    bars.set(grade, { grade, at: axis.grades.indexOf(grade), n: (had?.n ?? 0) + c.n })
  }
  return [...bars.values()].sort((a, b) => a.at - b.at)
}
