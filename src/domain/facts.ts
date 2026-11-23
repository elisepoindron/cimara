import type { ActivitySchema, FactDef } from './registry.ts'
import type { Ordered, Quantity } from './quantity.ts'
import { chartStep, chartSteps } from './quantity.ts'

/** What a cell reads where a fact declared `whenAbsent: 'dash'` was never recorded. */
export const ABSENT = '—'

export type StoredFacts = Readonly<Record<string, unknown>>

export interface Part {
  readonly id: string
  readonly group: string | null
  readonly position: number
  readonly fields: StoredFacts
}

export interface FactValue {
  readonly def: FactDef
  readonly value: unknown
  readonly text: string
}

export class FactError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`facts do not match the registry:\n  ${problems.join('\n  ')}`)
    this.problems = problems
  }
}

function rank<T>(q: Quantity<T>, v: T): number {
  return 'ordinal' in q ? (q as Ordered<T>).ordinal(v) : Number(v)
}

function partField(schema: ActivitySchema, fieldId: string): FactDef {
  const def = schema.parts?.fields.find(f => f.id === fieldId)
  if (!def) throw new Error(`${schema.id}: no part field "${fieldId}"`)
  return def
}

/** Ordered part-field values, lowest first. Throws nothing: bad values are skipped. */
function sortedPartValues(schema: ActivitySchema, parts: readonly Part[], fieldId: string): unknown[] {
  const def = partField(schema, fieldId)
  const values: unknown[] = []
  for (const p of parts) {
    try { values.push(def.quantity.parse(p.fields[fieldId])) } catch { /* reported elsewhere */ }
  }
  return values.sort((a, b) => rank(def.quantity, a as never) - rank(def.quantity, b as never))
}

/**
 * Resolves one declared list of facts (header facts, or access facts) against
 * an itinerary's stored values and parts. Derived facts are computed from the
 * parts; the rest come from storage. Reports every problem at once, so a bad
 * row is fixed in one pass.
 */
function resolveList(
  schema: ActivitySchema,
  defs: readonly FactDef[],
  stored: StoredFacts,
  parts: readonly Part[],
): FactValue[] {
  const problems: string[] = []
  const values: FactValue[] = []

  for (const def of defs) {
    let raw: unknown
    if (def.derived?.op === 'count') {
      raw = parts.length
    } else if (def.derived?.op === 'range') {
      const sorted = sortedPartValues(schema, parts, def.derived.field)
      if (sorted.length === 0) {
        // No part holds the field. For an optional fact that is the same
        // absence as an empty stored value, and is treated the same way; for a
        // required one it is still the error that stops a deploy.
        if (!def.optional) {
          problems.push(`${def.id}: cannot derive from part field "${def.derived.field}" — no parts`)
        } else if (def.whenAbsent === 'dash') {
          values.push({ def, value: null, text: ABSENT })
        }
        continue
      }
      raw = [sorted[0], sorted[sorted.length - 1]]
    } else {
      raw = stored[def.id]
      if (raw === undefined || raw === null) {
        // A fact the registry declares optional is one the archive may
        // genuinely not know, and absent is not wrong. Everything else missing
        // is an error loud enough to stop a deploy, which is what the boot
        // check is for. An optional fact that asks for a dash gets one, so
        // its label stays on the page.
        if (!def.optional) problems.push(`${def.id}: missing`)
        else if (def.whenAbsent === 'dash') values.push({ def, value: null, text: ABSENT })
        continue
      }
    }

    try {
      const value = def.quantity.parse(raw)
      values.push({ def, value, text: def.quantity.format(value as never) })
    } catch (err) {
      problems.push(`${def.id}: ${(err as Error).message}`)
    }
  }

  if (problems.length) throw new FactError(problems)
  return values
}

/** Every header fact for an itinerary, in the order the registry declares. See `resolveList`. */
export function resolveFacts(
  schema: ActivitySchema, stored: StoredFacts, parts: readonly Part[],
): FactValue[] {
  return resolveList(schema, schema.facts, stored, parts)
}

/**
 * The facts a body section reads rather than the header strip — today,
 * "Accesso e parcheggio"'s four fields, via `schema.access`. Same resolution
 * rules as `resolveFacts`; every one of them is optional by construction
 * (`defineActivity` refuses an `access` fact that is not), so a `FactError`
 * from this function only ever means a *present* value the registry can't
 * read, never a missing one.
 */
export function resolveAccessFacts(
  schema: ActivitySchema, stored: StoredFacts, parts: readonly Part[],
): FactValue[] {
  return resolveList(schema, schema.access ?? [], stored, parts)
}

/**
 * One fact, resolved by the same rules as the header strip, or null where it
 * cannot be shown — missing, optional and absent (including a fact declared
 * `whenAbsent: 'dash'`, whose dash belongs to the page strip, not to a row
 * cell), or present and unreadable.
 *
 * Never throws. The route page refuses a bad route loudly and the boot check
 * reports it; a Find page of twenty rows must not go down because one of them
 * is wrong.
 */
export function readFact(
  schema: ActivitySchema, def: FactDef, stored: StoredFacts, parts: readonly Part[],
): FactValue | null {
  try {
    const value = resolveList(schema, [def], stored, parts)[0] ?? null
    return value === null || value.value === null ? null : value
  } catch {
    return null
  }
}

/** How many parts hold each value of a field, in scale order. Grades with none are absent. */
export function distributionOf(
  schema: ActivitySchema,
  parts: readonly Part[],
  fieldId: string,
): { value: string; n: number }[] {
  const def = partField(schema, fieldId)
  // Keyed by the parsed value's rank, so sorting never re-parses the formatted
  // label — format() is not the identity for every quantity (`metres.format(14)`
  // is `'14 m'`, and `metres.parse('14 m')` throws).
  const tally = new Map<number, { value: string; n: number }>()
  for (const p of parts) {
    try {
      const v = def.quantity.parse(p.fields[fieldId])
      const key = rank(def.quantity, v as never)
      const entry = tally.get(key)
      if (entry) entry.n++
      else tally.set(key, { value: def.quantity.format(v as never), n: 1 })
    } catch { /* a bad part value is reported by resolveFacts, not counted here */ }
  }
  return [...tally.entries()].sort(([a], [b]) => a - b).map(([, e]) => e)
}

/** The sport grades a crag's chart always spans, empty columns included. */
export const CRAG_CHART_RANGE = ['5a', '8c'] as const

/**
 * The grade distribution as the crag page draws it: every step of
 * `CRAG_CHART_RANGE`, widened to the easiest and hardest grade present, the
 * empty ones included at zero — so every crag is drawn on the same columns and
 * a gap is seen rather than closed up — and a plus counted with its letter
 * (`chartStep`). Any other field is `distributionOf` unchanged.
 */
export function gradeSpreadOf(
  schema: ActivitySchema,
  parts: readonly Part[],
  fieldId: string,
): { value: string; n: number }[] {
  const spread = distributionOf(schema, parts, fieldId)
  if (spread.length === 0 || partField(schema, fieldId).quantity.kind !== 'grade:sport') return spread

  const steps = chartSteps('sport')
  const counts = new Map<string, number>()
  for (const { value, n } of spread) {
    const step = chartStep('sport', value)
    counts.set(step, (counts.get(step) ?? 0) + n)
  }
  // The range every crag is drawn on, so one chart reads against another; a
  // grade outside it widens it just enough to be drawn.
  const at = [...counts.keys(), ...CRAG_CHART_RANGE].map(s => steps.indexOf(s))
  return steps.slice(Math.min(...at), Math.max(...at) + 1)
    .map(value => ({ value, n: counts.get(value) ?? 0 }))
}

/**
 * The ordinal a grade quantity yields for one stored value. A grade is
 * recognised by its `grade:` kind, the same test Find makes; an ordered
 * quantity that is not a grade (wall angle, clock time) is not one, and a range
 * of grades has a `range:` kind so it is not one either.
 */
function ordinalsOf(quantity: Quantity<unknown>, raw: unknown): number[] {
  if (!quantity.kind.startsWith('grade:') || !('ordinal' in quantity)) return []
  const scale = quantity as Ordered<unknown>
  try {
    return [scale.ordinal(quantity.parse(raw))]
  } catch {
    // A stored value the scale refuses is not a grade. Nothing here validates
    // the archive; that is the boot check's job, and a bad row must not stop a
    // route being findable by everything else about it.
    return []
  }
}

/**
 * A route's grade range, on its activity's own scale, as ordinals — or null
 * where it declares no grade at all.
 *
 * Which field holds a grade is the registry's business, not this function's.
 * Alpinismo carries one in its facts; falesia carries none there and derives its
 * range from its pitches, each of which declares a `grado`. Both are found by
 * asking each declared quantity whether it is a grade (its `grade:` kind, as
 * Find does; wall angle and clock time are ordered but not grades), so a nineteenth activity
 * needs no case here and no migration.
 *
 * Only comparable inside one scale: AD is 6 on the alpine scale and 6a is 13 on
 * the sport one. Safe because a grade constraint always carries its activity.
 */
/**
 * The stored facts with every fact `more` holds and they do not, or null when
 * `more` adds nothing. A value already stored is never replaced: somebody may
 * have corrected it since.
 */
export function withMissingFacts(stored: StoredFacts, more: StoredFacts): StoredFacts | null {
  const added = Object.entries(more).filter(([id, v]) => v !== undefined && v !== null && !(id in stored))
  return added.length === 0 ? null : { ...stored, ...Object.fromEntries(added) }
}

/**
 * A route that both says how many pitches it has and lists them must agree
 * with itself. Returns the problem in words, or null.
 */
export function pitchCountMismatch(facts: StoredFacts, parts: readonly Part[]): string | null {
  const said = facts.tiri
  return typeof said === 'number' && parts.length > 0 && said !== parts.length
    ? `tiri says ${said}, but ${parts.length} pitches are listed`
    : null
}

export function gradeBoundsOf(
  schema: ActivitySchema, facts: StoredFacts, parts: readonly Part[],
): { min: number; max: number } | null {
  const ordinals: number[] = []

  for (const def of schema.facts) {
    ordinals.push(...ordinalsOf(def.quantity, facts[def.id]))
  }
  // A route graded in its header is that grade: a multi-pitch's easy last
  // pitch does not make it a route for a beginner. Only where the header holds
  // no grade (a crag, graded by its vie) do the parts decide.
  if (ordinals.length > 0) return { min: Math.min(...ordinals), max: Math.max(...ordinals) }
  for (const field of schema.parts?.fields ?? []) {
    for (const part of parts) ordinals.push(...ordinalsOf(field.quantity, part.fields[field.id]))
  }

  return ordinals.length === 0
    ? null
    : { min: Math.min(...ordinals), max: Math.max(...ordinals) }
}
