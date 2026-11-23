import { ASPECT_LABELS, ROCK_LABELS, type Aspect, type Quantity, type Rock } from './quantity.ts'

export type Derivation =
  | { readonly from: 'parts'; readonly op: 'range'; readonly field: string }
  | { readonly from: 'parts'; readonly op: 'count' }

/**
 * A phrase Find reads as a question about this fact. Declared here, beside the
 * fact, so Find still parses against the registry rather than a list of its
 * own: a word is a constraint because a fact by that meaning exists.
 */
export interface FindPhrase {
  /** Every spelling, as a visitor types it. The one they typed is read back. */
  readonly it: readonly string[]
  /**
   * 'is': the stored value equals `value`. 'includes': the stored list holds it.
   * 'atMost' and 'atLeast': the stored number is no more, or no less, than it —
   * a threshold a climber names in round figures, "entro 10 min", "almeno 20
   * vie", rather than any number typed.
   */
  readonly match: 'is' | 'includes' | 'atMost' | 'atLeast'
  readonly value: string | boolean | number
}

export function findIs(value: string | boolean, ...it: string[]): FindPhrase {
  return { it, match: 'is', value }
}

export function findIncludes(value: string, ...it: string[]): FindPhrase {
  return { it, match: 'includes', value }
}

export function findAtMost(value: number, ...it: string[]): FindPhrase {
  return { it, match: 'atMost', value }
}

export function findAtLeast(value: number, ...it: string[]): FindPhrase {
  return { it, match: 'atLeast', value }
}

/**
 * The eight ways a wall can face, as Find reads them: `esposte a sud`,
 * `esposta a sud`, `esposizione sud`, `a sud`, `verso sud`. Plural first,
 * because the sentence reads "Cerco falesie esposte a sud". Never the bare
 * `sud`, which is half the route names in the Alps — `Spigolo Sud`, `Cresta
 * Sud` — and must stay a name. Shared by every activity with an aspect, so one
 * phrase asks it of all of them.
 *
 * Sun and shade are said as a direction too: `al sole` is a wall facing south,
 * `all'ombra` one facing north. That is what a climber means by them, and the
 * sentence reads back `esposte a sud`, one click from any other way.
 */
const SUN: Partial<Record<Aspect, readonly string[]>> = {
  S: ['al sole', 'soleggiata', 'soleggiate', 'assolata', 'assolate'],
  N: ['all\'ombra', 'in ombra', 'ombreggiata', 'ombreggiate', 'ombrosa', 'ombrose'],
}

export function findAspect(): readonly FindPhrase[] {
  return (Object.entries(ASPECT_LABELS) as [Aspect, string][]).map(([value, label]) => {
    const word = label.toLowerCase()
    const forms = [...new Set([word, word.replace('-', ''), word.replace('-', ' ')])]
    const spellings = forms.flatMap(w => [`esposte a ${w}`, `esposta a ${w}`, `esposizione ${w}`])
    spellings.push(...forms.flatMap(w => [`esposizione a ${w}`, `rivolta a ${w}`, `rivolte a ${w}`, `verso ${w}`, `a ${w}`]))
    return findIs(value, ...spellings, ...(SUN[value] ?? []))
  })
}

/**
 * The rocks a crag can be made of, as Find reads them: `su calcare` first,
 * since the sentence reads "Cerco falesie su calcare", then the bare word and
 * the adjectives a climber uses — `calcarea`, `granitica`.
 */
const ROCK_WORDS: Partial<Record<Rock, readonly string[]>> = {
  calcare: ['calcarea', 'calcaree', 'calcareo'], dolomia: ['dolomitica', 'dolomitiche', 'dolomite'],
  calcescisto: ['calcescisti'], granito: ['granitica', 'granitiche'], conglomerato: ['puddinga'],
  serpentinite: ['serpentino'], basalto: ['basaltica', 'basaltiche'],
}

export function findRock(): readonly FindPhrase[] {
  return (Object.entries(ROCK_LABELS) as [Rock, string][]).map(([value, label]) => {
    const word = label.toLowerCase()
    return findIs(value, `su ${word}`, word, `di ${word}`, `in ${word}`, ...(ROCK_WORDS[value] ?? []))
  })
}

export interface FactDef<T = unknown> {
  readonly id: string
  readonly quantity: Quantity<T>
  readonly label: { readonly it: string }
  readonly derived?: Derivation
  /**
   * A fact the archive may genuinely not know.
   *
   * Everything else is required, and a route missing it fails the boot check
   * and its own page rather than rendering a blank. That is right for a fact
   * the archive defines a route by, and wrong for one a contributor simply
   * never filled in — a twenty-year-old archive holds routes whose grade
   * nobody recorded, and refusing to hold them is a claim about the world that
   * is false.
   *
   * An optional fact that is absent is absent: it is skipped rather than
   * reported, and the facts strip is one item shorter. An optional fact that is
   * *present and wrong* is still an error, because a value nobody can read is
   * not the same as a value nobody wrote.
   */
  readonly optional?: boolean
  /**
   * What the page shows where an optional fact is absent. `'skip'` (the
   * default) leaves the cell out, as `ombra_dalle` always has. `'dash'` keeps
   * the label and writes a dash: the crag's guidebook facts are mostly
   * unrecorded across the archive, and an always-present label shows a reader
   * that nobody has said, rather than letting a missing cell read as "no".
   */
  readonly whenAbsent?: 'skip' | 'dash'
  /**
   * Where the page draws this fact. `'strip'` (the default) is the header;
   * `'giudizi'` is the header's second line of star ratings, which are opinions
   * about the crag rather than measurements of it, kept apart by a hairline.
   */
  readonly placement?: 'strip' | 'giudizi'
  /**
   * A value that is a warning when the fact holds it — `true` for rockfall.
   * The strip marks that cell; the word is still written, so colour is never
   * the only carrier.
   */
  readonly warnIf?: unknown
  /** The phrases Find reads as a question about this fact. */
  readonly find?: readonly FindPhrase[]
}

export function fact<T>(
  id: string,
  quantity: Quantity<T>,
  opts: {
    label: { it: string }; derived?: Derivation; optional?: boolean
    whenAbsent?: 'skip' | 'dash'; placement?: 'strip' | 'giudizi'; warnIf?: T
    find?: readonly FindPhrase[]
  },
): FactDef<T> {
  return {
    id, quantity, label: opts.label, derived: opts.derived, optional: opts.optional,
    whenAbsent: opts.whenAbsent, placement: opts.placement, warnIf: opts.warnIf,
    find: opts.find,
  }
}

/** Spread the named field of every part into a range. */
export function fromParts(field: string): Derivation {
  return { from: 'parts', op: 'range', field }
}

/** How many parts there are. */
export function countParts(): Derivation {
  return { from: 'parts', op: 'count' }
}

export type SectionKind = 'prose' | 'generated' | 'furniture'

/** A section drawn from data rather than written. The renderer is named here. */
export type GeneratedSection = 'profilo' | 'gradi' | 'settori' | 'tiri'

/**
 * A furniture section with a live renderer behind it. Named explicitly, the same
 * way a generated section names its renderer — so which furniture section is the
 * conditions module is a declared fact, not a coincidence of id spelling.
 */
export type FurnitureRender =
  'condizioni' | 'relazioni' | 'parcheggio' | 'punti' | 'strada' | 'traccia' | 'foto' | 'vicine'

export interface SectionDef {
  readonly id: string
  readonly label: { readonly it: string }
  readonly kind: SectionKind
  readonly render?: GeneratedSection | FurnitureRender
  /**
   * Sections that share a group render inside one `<div class="{group}">`, when
   * contiguous — route.html and crag.html both wrap a run of the document column
   * in `.tail`, a bordered auto-fit grid distinct from the single-column sections
   * around it.
   */
  readonly group?: string
  /**
   * Further texts of the same kind, each stored in the sections bag under its
   * own id and drawn inside this section, after its own words and in this
   * order, each behind a small label — a crag's history after its
   * presentation, a multi-pitch's gear and notes after its description. Not
   * sections of their own: a few sentences do not earn a title.
   */
  readonly runIns?: readonly RunIn[]
  /**
   * The run-in whose words stand in for the section's own when it has none,
   * drawn as the body and unlabelled: a crag has no description, so its note
   * describes it.
   */
  readonly lead?: string
  /**
   * A two-point access panel's own point (`render: 'punti'`): its name in the
   * row and how the map names it. A crag's wall when absent; a multi-pitch's
   * is where the climbing starts.
   */
  readonly point?: { readonly it: string; readonly of: string }
}

/** A text drawn inside another section, behind a small label — see `runIns`. */
export interface RunIn {
  readonly id: string
  readonly label: { readonly it: string }
}

/** Authored text, stored in the itinerary's sections bag under this id. */
export function prose(id: string, it: string, group?: string): SectionDef {
  return { id, label: { it }, kind: 'prose', group }
}

/**
 * Authored text that carries other texts inside it, each behind a small label
 * after its own words — see `runIns`.
 */
export function proseWith(
  id: string, it: string, runIns: readonly { readonly id: string; readonly it: string }[],
): SectionDef {
  return {
    id, label: { it }, kind: 'prose',
    runIns: runIns.map(r => ({ id: r.id, label: { it: r.it } })),
  }
}

/**
 * A route's own words, the same section on every activity: `Descrizione`, the
 * description first, then the source archive's `Note` behind a small label, with
 * whatever else the activity keeps (`before` it, a route's gear; `after` it, a
 * crag's history). A note is what is worth knowing besides the way, an
 * overview as often as a season or a map reference, so it is never titled as
 * a presentation. Where there is no description, as on every crag, the note is
 * the description, unlabelled.
 */
export function description(extras: {
  readonly before?: readonly { readonly id: string; readonly it: string }[]
  readonly after?: readonly { readonly id: string; readonly it: string }[]
} = {}): SectionDef {
  return {
    ...proseWith('descrizione', 'Descrizione',
      [...(extras.before ?? []), { id: 'note', it: 'Note' }, ...(extras.after ?? [])]),
    lead: 'note',
  }
}

/**
 * Every key of the itinerary's sections bag a list of sections reads, each with
 * the section that draws it: a prose section's own id, and its run-ins'.
 */
export function storedProse(sections: readonly SectionDef[]): Map<string, SectionDef> {
  const keys = new Map<string, SectionDef>()
  for (const s of sections) {
    if (s.kind !== 'prose') continue
    keys.set(s.id, s)
    for (const r of s.runIns ?? []) keys.set(r.id, s)
  }
  return keys
}

/** Drawn from the itinerary's own data — a profile, a histogram, a list of vie. */
export function generated(id: string, it: string, render: GeneratedSection, group?: string): SectionDef {
  return { id, label: { it }, kind: 'generated', render, group }
}

/**
 * Declared so the page's shape is complete. Most furniture has no data until a
 * later project and renders nothing; `render` names the ones that already do
 * (today, `'condizioni'` and `'relazioni'`) — the id is free to be anything,
 * the renderer dispatches on `render`, not on spelling a magic id right.
 */
export function furniture(id: string, it: string, render?: FurnitureRender, group?: string): SectionDef {
  return { id, label: { it }, kind: 'furniture', render, group }
}

/**
 * The access panel with two named points over a map of both, the parking and
 * the itinerary's own: `point` names the second, `of` as the map says it —
 * `pointsPanel('parcheggio', 'Come arrivare', { it: 'Attacco', of: 'dell\u2019attacco' })`.
 */
export function pointsPanel(id: string, it: string, point: { it: string; of: string }): SectionDef {
  return { id, label: { it }, kind: 'furniture', render: 'punti', point }
}

/** The pictures a Find row may put before a value. Each is drawn once, in src/render/facts-line.ts. */
export type RowIcon = 'vie' | 'esp' | 'avv' | 'grado' | 'dplus' | 'km'

/**
 * One cell of the line of facts a Find row shows under the route's name.
 *
 * A fact is one of the activity's header facts with its icon; a histogram is the
 * spread of a graded part field across the vie; the distance is Find's own,
 * from the place the visitor named, and exists only when one was. Grades are
 * two header grades in one cell behind one difficulty icon, each named in
 * words — a multi-pitch's obligatory and hardest — so the icon is never drawn
 * twice for one route (find-row-multipitch-options.html).
 */
export type RowItem =
  | { readonly kind: 'fact'; readonly fact: string; readonly icon: RowIcon }
  | { readonly kind: 'histogram'; readonly field: string }
  | { readonly kind: 'distance' }
  | { readonly kind: 'grades'; readonly low: RowGrade; readonly high: RowGrade }

/** One of the two grades a `grades` cell writes: the header fact and the word before it. */
export interface RowGrade {
  readonly fact: string
  readonly it: string
}

export function rowFact(fact: string, icon: RowIcon): RowItem {
  return { kind: 'fact', fact, icon }
}

export function histogram(field: string): RowItem {
  return { kind: 'histogram', field }
}

export function distance(): RowItem {
  return { kind: 'distance' }
}

/** Two header grades in one cell, the easier first: `rowGrades(['grado_obbligatorio', 'obbligatoria'], ['grado_max', 'max'])`. */
export function rowGrades(low: [fact: string, it: string], high: [fact: string, it: string]): RowItem {
  return { kind: 'grades', low: { fact: low[0], it: low[1] }, high: { fact: high[0], it: high[1] } }
}

/** Find's list grid has four fact columns; app.css places them by position. */
export const ROW_MAX = 4

export interface PartsDef {
  /** Plural, as a heading: "Vie", "Tiri", "Calate". */
  readonly label: { readonly it: string }
  /** Singular, inside a sentence: "9 vie" but "1 via". */
  readonly each: { readonly it: string }
  readonly ordered: boolean
  readonly optional: boolean
  /** "Settore", the heading over each group of parts. */
  readonly groupBy?: { readonly it: string }
  readonly fields: readonly FactDef[]
}

export function parts(cfg: {
  label: { it: string }
  each: { it: string }
  ordered: boolean
  optional?: boolean
  groupBy?: { it: string }
  fields: readonly FactDef[]
}): PartsDef {
  return {
    label: cfg.label,
    each: cfg.each,
    ordered: cfg.ordered,
    optional: cfg.optional ?? false,
    groupBy: cfg.groupBy,
    fields: cfg.fields,
  }
}

/**
 * A figure the conditions column adds under the weather for an activity that
 * asks for it. The last rain and the sunset are every activity's; these are
 * what a mountain needs and a crag does not.
 */
export type SkyFigure = 'zero_termico' | 'neve_fresca'

export interface ActivitySchema {
  readonly id: string
  readonly label: { readonly it: string }
  /**
   * What a search for this activity asks for, inside Find's sentence:
   * "Cerco falesie", "Cerco vie di alpinismo". Absent, the sentence uses the
   * label in lower case.
   */
  readonly plural?: { readonly it: string }
  /**
   * One of them, as a climber writes it in a line: "una via di alpinismo".
   * Absent, the label is that already ("una falesia"). Find reads it, and the
   * plural, as the activity.
   */
  readonly singular?: { readonly it: string }
  /**
   * Other words a climber uses for this activity in a search: "arrampicata",
   * "via alpinistica". Read by Find as the activity, never shown.
   */
  readonly also?: { readonly it: readonly string[] }
  readonly facts: readonly FactDef[]
  /**
   * Facts shown inside a body section rather than the header strip — today,
   * "Accesso e parcheggio"'s four fields. Optional: most activities have
   * none, and one whose access info is just written prose can still declare
   * that section with `prose(...)` instead of adopting this at all.
   */
  readonly access?: readonly FactDef[]
  /** The main column, in render order. */
  readonly document: readonly SectionDef[]
  /** The aside, in render order. Its contents differ per activity. */
  readonly rail: readonly SectionDef[]
  readonly parts?: PartsDef
  /**
   * What a Find or Preferiti row shows under the route's name, in order.
   * Optional: an activity with none gets a row without a facts line, so a
   * prose-only activity stays one file.
   */
  readonly row?: readonly RowItem[]
  /**
   * How long a report counts as recent: what Find ranks on and what a nearby
   * route's "3 relazioni" counts. Seven days for alpinismo; a crag's fourteen
   * is invented and should be argued with. Nothing is graded against it.
   */
  readonly current: { readonly days: number }
  /** The conditions column's extra figures, in order. Absent: none. */
  readonly skyFigures?: readonly SkyFigure[]
}

/** Part fields a generated renderer reads, keyed by the renderer it names. */
const GENERATED_PART_FIELDS: Record<GeneratedSection, readonly string[]> = {
  profilo: [],
  gradi: ['grado'],
  settori: ['nome', 'lunghezza', 'grado'],
  tiri: ['grado', 'grado_fino', 'lunghezza', 'descrizione'],
}

export function defineActivity(a: ActivitySchema): ActivitySchema {
  const access = a.access ?? []
  const ids = [...a.facts, ...access].map(f => f.id)
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
  if (duplicate) {
    throw new Error(
      `${a.id}: duplicate fact id "${duplicate}" — facts and access share one storage bag`)
  }

  const required = access.find(f => !f.optional)
  if (required) {
    throw new Error(
      `${a.id}: access fact "${required.id}" must be optional — an access fact may never `
      + `force a boot failure`)
  }

  if (!(a.current.days > 0)) {
    throw new Error(`${a.id}: current.days must be a positive number of days`)
  }
  for (const f of a.facts) {
    if (f.whenAbsent === 'dash' && !f.optional) {
      throw new Error(
        `${a.id}: fact "${f.id}" shows a dash when absent, so it must be optional — a required fact is never absent`)
    }
  }
  for (const f of a.facts) {
    const d = f.derived
    if (d?.op === 'range' && !a.parts?.fields.some(p => p.id === d.field)) {
      throw new Error(
        `${a.id}: fact "${f.id}" derives from part field "${d.field}", which no part declares`)
    }
  }

  // A generated section throws at render time, a 500 to a climber, if the
  // fields its renderer reads are not declared — check it here instead, at
  // boot, like every other registry mismatch in this project.
  const declaredFields = new Set(a.parts?.fields.map(f => f.id) ?? [])
  for (const section of [...a.document, ...a.rail]) {
    if (section.kind !== 'generated' || !section.render) continue
    const required = GENERATED_PART_FIELDS[section.render as GeneratedSection]
    const missing = required.filter(field => !declaredFields.has(field))
    if (missing.length) {
      throw new Error(
        `${a.id}: section "${section.id}" is generated by "${section.render}", which reads part `
        + `field(s) ${missing.map(f => `"${f}"`).join(', ')}, which no part declares`)
    }
  }

  // A row that names something the activity does not declare would render an
  // empty cell on every Find page forever, and nothing would say why. Refused
  // here, at boot, like every other registry mismatch.
  const row = a.row ?? []
  if (row.length > ROW_MAX) {
    throw new Error(`${a.id}: row declares ${row.length} items; Find's list has ${ROW_MAX} fact columns`)
  }
  for (const item of row) {
    if (item.kind === 'fact') {
      const def = a.facts.find(f => f.id === item.fact)
      if (!def) throw new Error(`${a.id}: row fact "${item.fact}" is not a declared header fact`)
      if (item.icon === 'esp' && def.quantity.kind !== 'aspect') {
        throw new Error(`${a.id}: row fact "${item.fact}" has the compass icon, but its quantity is `
          + `"${def.quantity.kind}", not an aspect — the compass draws the value`)
      }
    } else if (item.kind === 'grades') {
      for (const g of [item.low, item.high]) {
        const def = a.facts.find(f => f.id === g.fact)
        if (!def) throw new Error(`${a.id}: row grade "${g.fact}" is not a declared header fact`)
        if (!def.quantity.kind.startsWith('grade:')) {
          throw new Error(`${a.id}: row grade "${g.fact}" is not a grade scale`)
        }
      }
    } else if (item.kind === 'histogram') {
      const field = a.parts?.fields.find(f => f.id === item.field)
      if (!field) {
        throw new Error(`${a.id}: row histogram reads part field "${item.field}", which no part declares`)
      }
      if (!field.quantity.kind.startsWith('grade:')) {
        throw new Error(`${a.id}: row histogram reads part field "${item.field}", which is not a grade scale`)
      }
    }
  }

  return a
}
