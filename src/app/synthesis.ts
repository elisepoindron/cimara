import type { Db } from '../db/open.ts'
import { giteFor, type GitaRow } from '../db/gita.ts'
import {
  saveSynthesis, synthesisFor, itinerariesAwaitingSynthesis, FLAG_KINDS,
  type Flag, type FlagKind, type ThemeCount,
} from '../db/synthesis.ts'

export interface CallModelInput {
  readonly itineraryName: string
  readonly reports: readonly { id: string; words: string }[]
  /** The themes the route already has, offered for reuse word for word: a new
   * report's point that says the same thing goes under the same name. */
  readonly previousLabels: readonly string[]
  /** The same for its lasting changes, with their kind. */
  readonly previousFlags: readonly { label: string; kind: FlagKind }[]
}

/** A report the model counts under a theme, and the words in it that say so.
 * Unverified until grounded: a quote not in the report drops the citation. */
export interface CallModelCitation {
  readonly reportId: string
  readonly quote: string
}

export interface CallModelTheme {
  readonly label: string
  readonly citations: readonly CallModelCitation[]
}

/** A lasting change to the route as the model reads it: a short name, a kind
 * (checked against `FLAG_KINDS`: anything else is not a kind), and for each
 * report that records it the sentence that says so. Unverified until grounded. */
export interface CallModelFlag {
  readonly label: string
  readonly kind: string
  readonly citations: readonly CallModelCitation[]
}

export interface CallModelResult {
  readonly themes: readonly CallModelTheme[]
  /** Optional so a model that only knows about themes still type-checks. */
  readonly flags?: readonly CallModelFlag[]
}

/**
 * The seam. Production wires a real implementation backed by `@anthropic-ai/sdk`
 * (`src/app/ai-client.ts`); every test here supplies a fake and never touches
 * the network — the same role `now` already plays for the clock everywhere
 * else in this codebase.
 */
export type CallModel = ((input: CallModelInput) => Promise<CallModelResult>) & {
  /** Between the first reading and the check, when there is one: see
   * `MergeThemes`. A fake with no `merge` merges nothing. */
  readonly merge?: MergeThemes
  /** The second reading, when there is one: see `CheckGroups`. A fake with no
   * `check` keeps every grounded citation, as the first reading alone did. */
  readonly check?: CheckGroups
}

/**
 * The first reading groups several hundred points at once, and on a busy crag
 * it names one idea twice: "Chiodatura ravvicinata" and "Chiodatura generosa",
 * "Avvicinamento breve" and "Comoda da raggiungere". Each such pair splits the
 * people who said it. So the themes it found, each with a few of its grounded
 * quotes, go to a step whose only job is to say which say the same thing.
 *
 * It sees the quotes, not only the names: from a name alone "generosa" could
 * mean good bolts as well as close ones, and a merge by name got one in three
 * wrong on La Vaccherezza. A merge it
 * gets wrong anyway is undone by the check that follows, which reads every
 * merged theme's quotes against the name kept and splits off any that do not
 * say it.
 *
 * Each group names the themes it joins by their index in the input and the
 * name to keep, one of theirs. It only joins evidence the first reading
 * grounded; it never brings new evidence in.
 */
export type MergeThemes = (input: MergeInput) => Promise<MergeResult>

export interface MergeInput {
  readonly itineraryName: string
  readonly themes: readonly { label: string; quotes: readonly string[] }[]
}

export interface MergeResult {
  readonly groups: readonly { readonly label: string; readonly themes: readonly number[] }[]
}

/** How many of a theme's quotes the merge step is shown: enough to tell what
 * the name means, few enough that a busy crag's hundred themes stay short. */
export const QUOTES_FOR_MERGE = 3

/**
 * A grounded quote proves the words are in the report, not that they say what
 * the theme says: "luogo molto bello" is really in a report, and is not a view.
 * So the themes and flags the first reading proposed, with their grounded
 * quotes, go to a second reading that sees only each name and its quoted words.
 * Where every quote says the whole name, the group comes back as it went. Where
 * a name bundles ideas the quotes say separately, it comes back split, one
 * group per idea, each with the quotes that say it — "Ambiente bello e
 * panoramico" into "Bel posto" and "Vista panoramica" — so a report that says
 * only one of them keeps its place under that one rather than leaving both.
 * Two groups that say the same thing in other words come back under one name,
 * and `regroup` makes them one ("Bel posto", "Ambiente bello", "Falesia
 * bella"). A quote that says none of it is left out: silence is not a yes. A flag that
 * records no lasting change (the weather that day, how the route always was)
 * is left out too.
 *
 * Each group returned names the group it came `from` (its index in the input),
 * and may only keep reports that group quoted: the check reorganises evidence,
 * it never brings new evidence in.
 */
export type CheckGroups = (input: CheckInput) => Promise<CheckResult>

export interface CheckInput {
  readonly itineraryName: string
  readonly themes: readonly { label: string; citations: readonly CallModelCitation[] }[]
  readonly flags: readonly { label: string; kind: FlagKind; citations: readonly CallModelCitation[] }[]
}

export interface CheckedGroup {
  readonly from: number
  readonly label: string
  readonly reportIds: readonly string[]
}

export interface CheckResult {
  readonly themes: readonly CheckedGroup[]
  readonly flags: readonly (CheckedGroup & { readonly kind: string })[]
}

/** Below this many standing reports, the route page lists no theme: there isn't
 * the volume for anything to recur across. The reading itself runs from the
 * first report, so that report already shows what it was read as. */
export const EVIDENCE_FLOOR = 5

/** A theme is shared, and counted on the route page, from two voices: one
 * person raising it is a point of theirs, not yet something the route is. */
export const SHARED_VOICES = 2

/**
 * Which reading writes the synthesis (migration 023). 2 reads every report
 * point by point, groups the points across reports, and keeps every theme with
 * the number of people behind it. 3 adds a step that merges the themes that
 * say the same thing (`MergeThemes`). Bump it when the reading changes, and
 * every route is read again once.
 */
export const READING = 3

/** From which reading a lasting change has a short name; before it a change
 * was only its sentence, and the pages do not show it as a name. */
export const CHANGES_NAMED_FROM = 2

/** Slack over the "about 60 characters" the prompt asks for. The model's own
 * schema says the same thing; this is the copy that is ours to enforce. */
const MAX_LABEL_CHARS = 80

/**
 * Reads a route's reports into its synthesis: only the ones not read yet.
 *
 * A report is read once. Its points go under the themes already there — the
 * model is shown their names and reuses one word for word where it says the
 * same thing — or start new ones, and the check runs on those new quotes only.
 * Reports already read keep their themes: reading the whole route again on
 * every filing moved them around each time (three readings of the same 32
 * reports agreed on 3), so a theme now changes only when someone writes
 * something new. A report withdrawn since is taken out of every theme and
 * flag, and one left with nothing behind it goes; that needs no model.
 *
 * The whole route is read, from scratch, only when there is no synthesis yet
 * or an earlier reading made it (`READING`): see `regenerateSynthesis`.
 *
 * Every grounding rule holds as before: a quote that is not, character for
 * character, in the report it names is not evidence, and the model never
 * states a count — this function computes every one that ends up on screen.
 *
 * A call that fails saves nothing: the route keeps what it last showed, the
 * reports stay unread, and the next filing or the startup pass reads them.
 * With no model (`callModel` null) nothing is read, but a withdrawn report is
 * still taken out: that is arithmetic, and a count must not go on including it.
 *
 * Two filings seconds apart can each read their report and save; the later
 * save may not hold the earlier report. It is then not in `read_ids`, so it is
 * read again by the next filing or at startup — late, never lost.
 */
export async function updateSynthesis(
  db: Db, itineraryId: string, itineraryName: string, callModel: CallModel | null, now: Date,
): Promise<void> {
  const previous = await synthesisFor(db, itineraryId)
  if (!previous || previous.reading < READING) {
    return regenerateSynthesis(db, itineraryId, itineraryName, callModel, now)
  }
  const gite = await giteFor(db, itineraryId)
  const standing = new Set(gite.map(g => g.id))
  const kept = {
    themes: previous.themes.map(t => themeOf(t.label, keepOnly(t, standing))).filter(t => t.count > 0),
    flags: previous.flags.map(f => flagOf(f.label, f.kind, keepOnly(f, standing))).filter(f => f.reportIds.length > 0),
    readIds: previous.readIds.filter(id => standing.has(id)),
  }
  const read = new Set(kept.readIds)
  const unread = gite.filter(g => !read.has(g.id))

  const withdrawn = kept.readIds.length !== previous.readIds.length
  if (unread.length === 0 || callModel === null) {
    if (callModel === null && unread.length > 0) console.log('synthesis: no model configured, reports left unread')
    if (withdrawn) await save(db, itineraryId, gite, kept, now)
    return
  }

  const added = await readReports(itineraryName, unread, callModel, kept)
  if (added === null) {
    if (withdrawn) await save(db, itineraryId, gite, kept, now)
    return
  }
  await save(db, itineraryId, gite, {
    themes: mergeByLabel(kept.themes, added.themes, (label, quotes) => themeOf(label, quotes)),
    flags: mergeByLabel(kept.flags, added.flags, (label, quotes, f) => flagOf(label, f.kind, quotes)),
    readIds: [...kept.readIds, ...unread.map(g => g.id)],
  }, now)
}

/**
 * Reads every standing report of a route from scratch, as if nothing had been
 * read: for a route with no synthesis yet, and for one an earlier reading made.
 * The names it showed before are offered for reuse, so a reading that changes
 * how reports are read does not rename every theme for nothing.
 *
 * With no model, nothing is read or written: "the model found nothing" is a
 * result worth saving, and a deploy that lost its key must not overwrite good
 * syntheses with it.
 */
export async function regenerateSynthesis(
  db: Db, itineraryId: string, itineraryName: string, callModel: CallModel | null, now: Date,
): Promise<void> {
  if (callModel === null) {
    console.log('synthesis: no model configured, skipping regeneration')
    return
  }
  const gite = await giteFor(db, itineraryId)
  if (gite.length === 0) return
  const previous = await synthesisFor(db, itineraryId)

  const read = await readReports(itineraryName, gite, callModel, {
    themes: [], flags: [], previousLabels: (previous?.themes ?? []).map(t => t.label),
    previousFlags: (previous?.flags ?? []).map(f => ({ label: f.label, kind: f.kind })),
  })
  if (read === null) return
  await save(db, itineraryId, gite, { ...read, readIds: gite.map(g => g.id) }, now)
}

/**
 * The model's reading of `reports`, grounded and checked: their themes and
 * flags, named after the ones in `known` wherever they say the same thing.
 * `null` when a call failed — the caller saves nothing new.
 */
async function readReports(
  itineraryName: string, reports: readonly GitaRow[], callModel: CallModel,
  known: {
    themes: readonly ThemeCount[]; flags: readonly Flag[]
    previousLabels?: readonly string[]; previousFlags?: readonly { label: string; kind: FlagKind }[]
  },
): Promise<{ themes: ThemeCount[]; flags: Flag[] } | null> {
  let result: CallModelResult
  try {
    result = await callModel({
      itineraryName,
      reports: reports.map(g => ({ id: g.id, words: g.words })),
      previousLabels: known.previousLabels ?? known.themes.map(t => t.label),
      previousFlags: known.previousFlags ?? known.flags.map(f => ({ label: f.label, kind: f.kind })),
    })
  } catch (err) {
    console.error('synthesis reading failed, keeping the previous cache:', err)
    return null
  }

  // A theme or flag with no label left after trimming is not one the page can
  // state, and one left with no grounded report has nothing behind it. One
  // report is enough for either: a theme one person raised still shows on
  // their report, and a flake that broke off is worth saying the first time.
  const themeSupported = (t: ThemeCount) => t.label.length > 0 && t.count > 0
  const flagSupported = (f: Flag) => f.label.length > 0 && f.reportIds.length > 0

  let themes: ThemeCount[] = result.themes
    .map(t => themeOf(labelOf(t.label), groundCitations(t.citations, reports)))
    .filter(themeSupported)
  let flags: Flag[] = (result.flags ?? []).flatMap(f => {
    const kind = kindOf(f.kind)
    return kind ? [flagOf(labelOf(f.label), kind, groundCitations(f.citations, reports))] : []
  }).filter(flagSupported)

  // Themes this reading named twice become one before the check, so the check
  // reads the merged theme's quotes against the name kept. A merge that fails
  // leaves them apart: that is the reading as it was, nothing lost.
  if (callModel.merge && themes.length > 1) {
    try {
      const merged = await callModel.merge({
        itineraryName,
        themes: themes.map(t => ({ label: t.label, quotes: Object.values(t.quotes ?? {}).slice(0, QUOTES_FOR_MERGE) })),
      })
      themes = applyMerges(themes, merged.groups).map(t => themeOf(t.label, inReportOrder(t.quotes ?? {}, reports)))
    } catch (err) {
      console.error('synthesis merge failed, reading on without it:', err)
    }
  }

  // Only what this reading found is checked; themes already there were checked
  // when their reports were read. A check that fails saves nothing.
  if (callModel.check && (themes.length > 0 || flags.length > 0)) {
    try {
      const checked = await callModel.check({
        itineraryName,
        themes: themes.map(t => ({ label: t.label, citations: citationsOf(t) })),
        flags: flags.map(f => ({ label: f.label, kind: f.kind, citations: citationsOf(f) })),
      })
      themes = regroup(checked.themes, themes)
        .map(g => themeOf(g.label, inReportOrder(g.quotes, reports))).filter(themeSupported)
      flags = regroup(checked.flags, flags).flatMap(g => {
        const kind = kindOf(g.kind)
        return kind ? [flagOf(g.label, kind, inReportOrder(g.quotes, reports))] : []
      }).filter(flagSupported)
    } catch (err) {
      console.error('synthesis check failed, keeping the previous cache:', err)
      return null
    }
  }
  return { themes, flags }
}

/**
 * The merge step's groups applied to the themes it was shown: each group's
 * themes become one, under the name kept, with every report any of them had
 * (a report keeps the quote it had first). A name that is none of the group's
 * own is not kept — the step chooses among names, it does not invent one — and
 * the group takes its best-supported member's. An index out of range, a theme
 * already in an earlier group, or a group left with fewer than two themes
 * changes nothing. Themes in no group come through as they were, in order.
 */
export function applyMerges(
  themes: readonly ThemeCount[], groups: MergeResult['groups'],
): ThemeCount[] {
  const taken = new Set<number>()
  const joined = new Map<number, ThemeCount>()
  for (const g of groups) {
    const members = [...new Set(g.themes)].filter(i => Number.isInteger(i) && themes[i] !== undefined && !taken.has(i))
    if (members.length < 2) continue
    const of = members.map(i => themes[i]!)
    const label = of.some(t => t.label === g.label.trim()) ? g.label.trim()
      : of.reduce((a, b) => (b.count > a.count ? b : a)).label
    const quotes: Record<string, string> = {}
    for (const t of of) for (const id of t.reportIds) if (!(id in quotes)) quotes[id] = t.quotes?.[id] ?? ''
    members.forEach(i => taken.add(i))
    // The merged theme stands where its first member stood.
    joined.set(Math.min(...members), themeOf(label, quotes))
  }
  return themes.flatMap((t, i) => joined.get(i) ?? (taken.has(i) ? [] : [t]))
}

/** A theme's or flag's quotes, kept only for reports still standing. */
function keepOnly(g: { reportIds: readonly string[]; quotes?: Readonly<Record<string, string>> }, standing: Set<string>) {
  return Object.fromEntries(g.reportIds.filter(id => standing.has(id)).map(id => [id, g.quotes?.[id] ?? '']))
}

/**
 * What a reading found, added to what was there: under the same name, one
 * group with both groups' reports (a report keeps the quote it had first);
 * under a new name, a new group.
 */
function mergeByLabel<G extends { label: string; reportIds: readonly string[]; quotes?: Readonly<Record<string, string>> }>(
  had: readonly G[], found: readonly G[], make: (label: string, quotes: Record<string, string>, first: G) => G,
): G[] {
  const byLabel = new Map<string, { first: G; quotes: Record<string, string> }>()
  for (const g of [...had, ...found]) {
    const entry = byLabel.get(g.label) ?? { first: g, quotes: {} }
    for (const id of g.reportIds) if (!(id in entry.quotes)) entry.quotes[id] = g.quotes?.[id] ?? ''
    byLabel.set(g.label, entry)
  }
  return [...byLabel.entries()].map(([label, e]) => make(label, e.quotes, e.first))
}

/** Saves a reading: voices counted, quotes in report order, newest first. */
async function save(
  db: Db, itineraryId: string, gite: readonly GitaRow[],
  data: { themes: readonly ThemeCount[]; flags: readonly Flag[]; readIds: readonly string[] }, now: Date,
): Promise<void> {
  const position = new Map(gite.map((g, i) => [g.id, i]))
  const newest = (f: Flag) => Math.min(...f.reportIds.map(id => position.get(id) ?? Infinity))
  await saveSynthesis(db, itineraryId, {
    generatedAt: now.toISOString(), reportCount: data.readIds.length,
    // Most people first, then most reports.
    themes: data.themes.map(t => themeOf(t.label, inReportOrder(t.quotes ?? {}, gite)))
      .map(withVoices(gite))
      .sort((a, b) => b.voices! - a.voices! || b.count - a.count),
    flags: data.flags.map(f => flagOf(f.label, f.kind, inReportOrder(f.quotes, gite)))
      .sort((a, b) => newest(a) - newest(b)),
    reading: READING,
    readIds: data.readIds,
  })
}

/** How many people stand behind a theme: distinct accounts among its reports,
 * each unsigned report a voice of its own (nobody can tell two apart). */
function withVoices(reports: readonly { id: string; accountId: string | null }[]) {
  const voiceOf = new Map(reports.map(r => [r.id, r.accountId ?? `report:${r.id}`]))
  return (t: ThemeCount): ThemeCount =>
    ({ ...t, voices: new Set(t.reportIds.map(id => voiceOf.get(id) ?? `report:${id}`)).size })
}

function labelOf(label: string): string {
  return label.trim().slice(0, MAX_LABEL_CHARS).trim()
}

function kindOf(kind: string): FlagKind | undefined {
  return FLAG_KINDS.find(k => k === kind)
}

/** A theme as saved: its reports are exactly the ones it has a quote for. */
function themeOf(label: string, quotes: Record<string, string>): ThemeCount {
  const reportIds = Object.keys(quotes)
  return { label, count: reportIds.length, reportIds, quotes }
}

function flagOf(label: string, kind: FlagKind, quotes: Record<string, string>): Flag {
  return { label, kind, reportIds: Object.keys(quotes), quotes }
}

function citationsOf(g: { reportIds: readonly string[]; quotes?: Readonly<Record<string, string>> }) {
  return g.reportIds.map(id => ({ reportId: id, quote: g.quotes![id]! }))
}

/**
 * What the check returned, held to what the first reading grounded: each group
 * keeps only reports its source group quoted, with the source's quote, and two
 * groups given the same name become one. A group naming no source sent is
 * dropped.
 */
export function regroup<C extends CheckedGroup>(
  checked: readonly C[],
  sources: readonly { reportIds: readonly string[]; quotes?: Readonly<Record<string, string>> }[],
): (C & { quotes: Record<string, string> })[] {
  const byLabel = new Map<string, C & { quotes: Record<string, string> }>()
  for (const g of checked) {
    const source = sources[g.from]
    const label = labelOf(g.label)
    if (!source || label === '') continue
    const merged = byLabel.get(label) ?? { ...g, label, quotes: {} }
    for (const id of g.reportIds) {
      const quote = source.quotes?.[id]
      if (quote !== undefined && !(id in merged.quotes)) merged.quotes[id] = quote
    }
    byLabel.set(label, merged)
  }
  return [...byLabel.values()]
}

/**
 * Keeps a citation only where its quote is, character for character, in the
 * words of the report it names — the screen shows the climber's own words or
 * nothing, never the model's paraphrase of them. A report never sent, a blank
 * quote, or a quote the model reworded is not evidence, so the report is not
 * counted. A report cited twice keeps its first grounded quote. Returned as
 * report id to quote, newest report first.
 */
export function groundCitations(
  citations: readonly CallModelCitation[], reports: readonly { id: string; words: string }[],
): Record<string, string> {
  const wordsById = new Map(reports.map(r => [r.id, r.words]))
  const kept: Record<string, string> = {}
  for (const c of citations) {
    const words = wordsById.get(c.reportId)
    const quote = c.quote.trim()
    if (words === undefined || quote === '' || c.reportId in kept) continue
    if (!words.includes(quote)) continue
    kept[c.reportId] = quote
  }
  return inReportOrder(kept, reports)
}

/** Report id to quote, in the order the reports were sent: newest first. */
function inReportOrder(
  quotes: Readonly<Record<string, string>>, reports: readonly { id: string }[],
): Record<string, string> {
  return Object.fromEntries(reports.flatMap(r => r.id in quotes ? [[r.id, quotes[r.id]!]] : []))
}

/**
 * Synthesizes every route that has a report and is not yet synthesized from
 * its current reports — the routes whose reports came from the seed or an
 * import, which no filing ever regenerated. Run in the background at startup:
 * the seed and the importer are offline tools that never read the key, and a
 * server that starts with a key is the one place a call can be made.
 *
 * One route at a time, so a fresh archive does not fire a burst of calls at
 * once. Each route goes through `regenerateSynthesis`, so its rules hold here
 * unchanged: a failed call keeps that route's previous cache and the pass moves
 * on to the next. With no model configured nothing is read or written.
 * Returns how many routes were attempted.
 */
export async function backfillSyntheses(
  db: Db, callModel: CallModel | null, now: () => Date,
): Promise<number> {
  if (callModel === null) return 0

  // From the first report, as a filing is: one report can flag a lasting change.
  const pending = await itinerariesAwaitingSynthesis(db, READING)
  if (pending.length > 0) console.log(`synthesis: backfilling ${pending.length} route(s)`)
  for (const it of pending) {
    await updateSynthesis(db, it.id, it.name, callModel, now())
  }
  return pending.length
}
