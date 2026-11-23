import Anthropic from '@anthropic-ai/sdk'
import type {
  CallModel, CallModelInput, CallModelResult, CheckGroups, CheckInput, CheckResult, MergeInput, MergeResult, MergeThemes,
} from './synthesis.ts'
import type { RewriteInput, RewriteLine } from './find.ts'
import { brand } from '../render/site.ts'

/**
 * The first reading, in two steps on Haiku: every report's points, then those
 * points grouped across reports into themes. Haiku 5.5, as Find's rewrite
 * already is: the reading writes something for every report, and it is the
 * cheapest model that does that well. The check that follows runs on Sonnet.
 */
const MODEL = 'claude-haiku-5-5'

/**
 * How many reports one extraction call reads. Each report comes back as a
 * handful of points with their words — a few hundred tokens — so thirty keep a
 * call's output to a few thousand tokens and its wait short; a busy crag's 120
 * reports are four calls side by side rather than one long one.
 */
const REPORTS_PER_CALL = 30

/**
 * Room for adaptive thinking and the answer, in both steps. The grouping
 * answer lists every point of the route — on a busy crag several hundred —
 * and 16000 cut one off mid-array; the calls are streamed, which is what the
 * SDK requires for a ceiling this high, and only what is written is billed.
 */
const MAX_TOKENS = 64000

/**
 * Hand-written JSON schemas, not the SDK's Zod `.parse()` helper — `zod`
 * never becomes a second new dependency. `additionalProperties: false` and
 * `required` on every level keep the response shape exactly this.
 *
 * Numbers in these schemas are 1-based positions into what this call sent, not
 * gita ids: short to echo, and meaningless outside the call, so nothing
 * downstream can mistake an unverified one for a real reference.
 *
 * No bound constraints anywhere — no `maxItems`, `maxLength`, or `minimum`.
 * The live API rejects every one of them on structured output ("property '...'
 * is not supported"): only bare `type`/`properties`/`items`/`required`/
 * `additionalProperties` are accepted. Every bound is enforced in code instead.
 */
const POINT = {
  type: 'object',
  properties: { label: { type: 'string' }, quote: { type: 'string' } },
  required: ['label', 'quote'],
  additionalProperties: false,
} as const

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    reports: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          report: { type: 'integer' },
          points: { type: 'array', items: POINT },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, kind: { type: 'string' }, quote: { type: 'string' } },
              required: ['label', 'kind', 'quote'],
              additionalProperties: false,
            },
          },
        },
        required: ['report', 'points', 'changes'],
        additionalProperties: false,
      },
    },
  },
  required: ['reports'],
  additionalProperties: false,
} as const

const EXTRACT_PROMPT =
  'You read Italian climbing trip reports ("relazioni") filed against one route or crag. Each '
  + 'report is given as "[n] text". Go through every report, sentence by sentence, and return '
  + 'every point it makes about the route or crag itself, leaving none out: the rock, the bolting '
  + 'and anchors, the length and steepness of the routes or pitches, the holds and the style of '
  + 'climbing, the grades and who the place suits, the sectors and particular routes, sun and '
  + 'shade, the approach and parking, the setting. "Peccato che i tiri siano corti. Chiodatura '
  + 'ascellare e roccia buona" makes three points: the pitches are short, the bolts are close, the '
  + 'rock is good.\n\n'
  + 'For each point give a short Italian label (two to five words, in the plain register of a '
  + 'trip-report summary, general enough that another climber saying the same thing in other '
  + 'words would get the same label: "Tiri brevi", "Chiodatura ravvicinata", "Roccia buona") and a '
  + 'quote: the few words of that report (at most about a dozen) that make the point, copied '
  + 'exactly as written, character for character, without correcting or translating them. One '
  + 'idea per point; do not join two with "e".\n\n'
  + 'Leave out what is only about that day: the weather, how wet or dry it was, snow, the crowd, '
  + 'who they climbed with, food. Those are not points about the route.\n\n'
  + 'Separately, under "changes", list any lasting change to the route or crag the report records, '
  + 'with a short Italian label naming it, a kind, and the sentence or clause that says it, copied '
  + 'exactly. The kind is "attenzione" for a change that asks a climber for care: a hold or flake '
  + 'that broke off, loose rock, bolts, chains or anchors damaged, loose or missing, a path '
  + 'blocked, a closure. It is "novita" for news that asks for no care: routes added, an unmarked '
  + 'route found, new bolts or rebolting, a path restored or re-marked, a new summit book, the '
  + 'base or the routes cleaned. Most reports have no change.\n\n'
  + 'Return one entry per report, by its number, even when it has no point.'

const GROUP_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
        required: ['label', 'points'],
        additionalProperties: false,
      },
    },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          kind: { type: 'string' },
          changes: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'kind', 'changes'],
        additionalProperties: false,
      },
    },
  },
  required: ['themes', 'flags'],
  additionalProperties: false,
} as const

const GROUP_PROMPT =
  'You are given the points a reader drew from climbing trip reports about one route or crag, '
  + 'each numbered "r.p" (point p of report r) with its label and the words it came from, and the '
  + 'lasting changes the reports record, numbered "r.c". Group them.\n\n'
  + 'Points that say the same thing, in whatever words, go under one theme, with a short Italian '
  + 'label every point in it says: "Spit ravvicinati", "Chiodatura ascellare" and "spit molto '
  + 'vicini" are one theme, "Chiodatura ravvicinata". One idea per theme; do not join two with '
  + '"e", and do not put a point under a theme that says more than it does: "luogo molto bello" '
  + 'goes under "Bel posto", not under "Ambiente bello e panoramico". A point no other point '
  + 'shares is a theme of its own, under its own label. Every point goes under exactly one theme. '
  + 'Under "points" and "changes", give only the numbers, as written between the brackets: "3.1", '
  + 'not the label or the words after it.\n\n'
  + 'You may be given the themes and changes the route already has. A point that says what one of '
  + 'them says goes under that name, reused word for word, so the reports already read and this '
  + 'one meet under one theme; only a point none of them says gets a new name. The same for '
  + 'changes: "5 nuovi tiri sulla destra" goes under an existing "Nuovi tiri aggiunti".\n\n'
  + 'Changes that record the same thing on the route go under one flag, with a short Italian label '
  + 'and the kind ("attenzione" or "novita") they share. A change to keep apart is its own flag. '
  + 'Return only the themes and flags this list of points fills: an existing theme no point here '
  + 'says is left out, not returned empty.'

/** Wired once at server startup from `ANTHROPIC_API_KEY`. Never constructed in a test. */
export function realCallModel(apiKey: string): CallModel {
  const client = new Anthropic({ apiKey })
  return Object.assign(readThemes(client), { merge: mergeThemes(client), check: checkGroups(client) })
}

/** A point or change as extracted: which report, and what the model said. */
interface Extracted {
  readonly reportId: string
  readonly label: string
  readonly quote: string
  readonly kind?: string
}

function readThemes(client: Anthropic): (input: CallModelInput) => Promise<CallModelResult> {
  return async (input: CallModelInput): Promise<CallModelResult> => {
    const batches: (typeof input.reports)[] = []
    for (let i = 0; i < input.reports.length; i += REPORTS_PER_CALL) {
      batches.push(input.reports.slice(i, i + REPORTS_PER_CALL))
    }
    const read = await Promise.all(batches.map(b => extract(client, input.itineraryName, b)))
    const points = read.flatMap(r => r.points)
    const changes = read.flatMap(r => r.changes)
    if (points.length === 0 && changes.length === 0) return { themes: [], flags: [] }
    return group(client, input, points, changes)
  }
}

/** One batch of reports, point by point. The quotes are grounded by the caller. */
async function extract(
  client: Anthropic, itineraryName: string, reports: CallModelInput['reports'],
): Promise<{ points: Extracted[]; changes: Extracted[] }> {
  const block = reports.map((r, i) => `[${i + 1}] ${r.words}`).join('\n\n')
  const parsed = await ask(client, EXTRACT_PROMPT, `Route or crag: ${itineraryName}\n\nReports:\n${block}`,
    EXTRACT_SCHEMA) as { reports?: unknown }
  if (!Array.isArray(parsed?.reports)) throw new Error('synthesis: extraction did not match the expected shape')

  const points: Extracted[] = []
  const changes: Extracted[] = []
  for (const entry of parsed.reports) {
    const e = entry as { report?: unknown; points?: unknown; changes?: unknown }
    // A number outside this batch refers to no report: its points are dropped.
    const reportId = reports[reportIndexOf(e?.report) - 1]?.id
    if (!Array.isArray(e.points) || !Array.isArray(e.changes)) {
      throw new Error('synthesis: extraction did not match the expected shape')
    }
    if (reportId === undefined) continue
    for (const p of e.points) points.push({ reportId, ...stringsOf(p, ['label', 'quote']) })
    for (const c of e.changes) changes.push({ reportId, ...stringsOf(c, ['label', 'quote', 'kind']) })
  }
  return { points, changes }
}

/** Every point and change of the route, grouped into themes and flags. */
async function group(
  client: Anthropic, input: CallModelInput, points: readonly Extracted[], changes: readonly Extracted[],
): Promise<CallModelResult> {
  // Numbered "r.p" by the report's place in the whole list, so the model sees
  // which points share a report; the map takes a number back to its point.
  const number = (items: readonly Extracted[]) => {
    const seen = new Map<string, number>()
    const position = new Map(input.reports.map((r, i) => [r.id, i + 1]))
    return new Map(items.map(it => {
      const n = (seen.get(it.reportId) ?? 0) + 1
      seen.set(it.reportId, n)
      return [`${position.get(it.reportId)}.${n}`, it] as const
    }))
  }
  const byPoint = number(points)
  const byChange = number(changes)
  const show = (m: Map<string, Extracted>) =>
    [...m].map(([n, it]) => `[${n}]${it.kind ? ` (${it.kind})` : ''} ${it.label} — «${it.quote}»`).join('\n')
  const content = [
    `Route or crag: ${input.itineraryName}`,
    input.previousLabels.length > 0
      ? `Themes the route already has:\n${input.previousLabels.map(l => `- ${l}`).join('\n')}` : '',
    input.previousFlags.length > 0
      ? `Changes the route already has:\n${input.previousFlags.map(f => `- (${f.kind}) ${f.label}`).join('\n')}` : '',
    `Points:\n${show(byPoint) || 'none'}`,
    `Changes:\n${show(byChange) || 'none'}`,
  ].filter(Boolean).join('\n\n')

  const parsed = await ask(client, GROUP_PROMPT, content, GROUP_SCHEMA) as { themes?: unknown; flags?: unknown }
  if (!Array.isArray(parsed?.themes) || !Array.isArray(parsed.flags)) {
    throw new Error('synthesis: grouping did not match the expected shape')
  }
  // A number that names no point sent cites nothing. The model is asked for
  // the bare "3.1" and sometimes echoes the whole line after it, so the
  // number is read from the front of whatever came back.
  const cite = (m: Map<string, Extracted>, ns: unknown) => {
    if (!Array.isArray(ns)) throw new Error('synthesis: grouping did not match the expected shape')
    return ns.flatMap(n => {
      const it = m.get(/^\s*\[?(\d+\.\d+)/.exec(String(n))?.[1] ?? '')
      return it ? [{ reportId: it.reportId, quote: it.quote }] : []
    })
  }
  const result = {
    themes: parsed.themes.map(entry => {
      const t = entry as { label?: unknown; points?: unknown }
      if (typeof t?.label !== 'string') throw new Error('synthesis: grouping did not match the expected shape')
      return { label: t.label, citations: cite(byPoint, t.points) }
    }),
    flags: parsed.flags.map(entry => {
      const f = entry as { label?: unknown; kind?: unknown; changes?: unknown }
      if (typeof f?.label !== 'string' || typeof f.kind !== 'string') {
        throw new Error('synthesis: grouping did not match the expected shape')
      }
      return { label: f.label, kind: f.kind, citations: cite(byChange, f.changes) }
    }),
  }
  // Points went in and none came back cited: the answer is broken, not empty.
  // Failing keeps the route's last synthesis; saving it would wipe the themes.
  const cited = [...result.themes, ...result.flags].some(g => g.citations.length > 0)
  if (!cited) throw new Error('synthesis: grouping cited none of the points it was given')
  return result
}

/**
 * One structured call, its JSON parsed. A response cut off at the token ceiling
 * is JSON that stops mid-array; saying so here is the difference between a
 * one-line fix and a day spent wondering why `JSON.parse` throws.
 */
async function ask(client: Anthropic, system: string, content: string, schema: object): Promise<unknown> {
  const response = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
  }).finalMessage()
  if (response.stop_reason === 'max_tokens') {
    throw new Error('synthesis: model response was truncated (max_tokens)')
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('synthesis: the model declined to answer')
  }
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('synthesis: model response carried no text content block')
  }
  return JSON.parse(block.text)
}

/** The named fields of an untrusted entry, each a string or the shape is wrong. */
function stringsOf<K extends string>(entry: unknown, keys: readonly K[]): Record<K, string> {
  const e = entry as Record<string, unknown> | null
  const out = {} as Record<K, string>
  for (const k of keys) {
    if (typeof e?.[k] !== 'string') throw new Error('synthesis: model response did not match the expected shape')
    out[k] = e[k] as string
  }
  return out
}

/** Integers are what the schemas ask for; a stringified one is the near miss
 * worth absorbing, since it changes nothing about which report is meant.
 * Anything else is not a reference to a report at all. */
function reportIndexOf(n: unknown): number {
  if (typeof n === 'number') return n
  if (typeof n === 'string' && /^\d+$/.test(n)) return Number(n)
  throw new Error('synthesis: model response did not match the expected shape')
}

// ---------------------------------------------------------------------------
// Synthesis, second reading: does each quote say what its name says?
// ---------------------------------------------------------------------------

/** `from` and `quotes` are the 1-based numbers the groups and quotes were shown with. */
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer' },
          label: { type: 'string' },
          quotes: { type: 'array', items: { type: 'integer' } },
        },
        required: ['from', 'label', 'quotes'],
        additionalProperties: false,
      },
    },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer' },
          label: { type: 'string' },
          kind: { type: 'string' },
          quotes: { type: 'array', items: { type: 'integer' } },
        },
        required: ['from', 'label', 'kind', 'quotes'],
        additionalProperties: false,
      },
    },
  },
  required: ['themes', 'flags'],
  additionalProperties: false,
} as const

const CHECK_SYSTEM_PROMPT =
  'You check what another reader drew from Italian climbing trip reports about one route or '
  + 'crag. You are given themes (points the reports make, some by one report only) and flags (lasting changes '
  + 'to the route). Each has a number, a label, and short quotes, each quote numbered and taken '
  + 'from a different report. Return them reorganised so that every quote you keep says, on its '
  + 'own, what the whole label it sits under says.\n\n'
  + 'For each theme or flag: if every quote says the whole label, return it unchanged. If the '
  + 'label bundles ideas the quotes say separately, split it into one group per idea, each with '
  + 'a short Italian label of its own and the quotes that say that idea; a quote that says '
  + 'several of the ideas may sit under each. "Ambiente bello e panoramico ben curato" with the '
  + 'quotes "luogo molto bello", "falesia ben curata" and "posto panoramico" becomes "Bel posto", '
  + '"Falesia curata" and "Vista panoramica". A quote that says the same thing in other words '
  + 'does say it: "spit vicini" says "Chiodatura ravvicinata". A quote that says none of the '
  + 'label is left out: "giornata estiva" does not say "Falesia ombreggiata". Judge only the '
  + 'quoted words, not what the report might have said around them.\n\n'
  + 'Two themes that say the same thing in other words are one theme: give them the same label, '
  + 'word for word, and they are merged. "Bel posto", "Ambiente bello" and "Falesia bella" are one '
  + 'theme; "Falesia ombrosa" and "Falesia fresca" are two, shade and coolness. The same goes for '
  + 'flags that record the same change.\n\n'
  + 'For each group you return, give "from", the number of the theme or flag it came from, and '
  + 'under "quotes" the numbers of its quotes within that one (quote 2.3 is quote 3 of number '
  + '2). Never move a quote to a group that did not come from its own. Keep a flag\'s kind '
  + '("attenzione" or "novita") unless the quote plainly says the other, and leave out a flag '
  + 'whose quote records no lasting change to the route: the weather or snow that day, how the '
  + 'route has always been, an opinion.'

/**
 * The check is a judgment — do these words say this? — and Haiku was too
 * lenient at it: on La Vaccherezza it kept "falesia che asciuga velocemente"
 * under "Falesia ombreggiata". So the second reading runs on Sonnet, the first
 * stays on Haiku: the first reading is long (every report) and the check is
 * short (labels and a few words per report), so the stronger model costs least
 * where it matters most.
 */
const CHECK_MODEL = 'claude-sonnet-5-5'

/** Room for adaptive thinking, plus every theme of a busy crag — now that a
 * point one report makes is a theme too, that can be a hundred groups. */
const CHECK_MAX_TOKENS = 32000

function checkGroups(client: Anthropic): CheckGroups {
  return async (input: CheckInput): Promise<CheckResult> => {
    const show = (title: string, groups: CheckInput['themes'], kinds?: readonly string[]) =>
      groups.map((g, i) => [
        `${title} ${i + 1}${kinds ? ` (${kinds[i]})` : ''}: ${g.label}`,
        ...g.citations.map((c, j) => `  [${i + 1}.${j + 1}] ${c.quote}`),
      ].join('\n')).join('\n\n')
    const content = [
      `Route or crag: ${input.itineraryName}`,
      input.themes.length > 0 ? `Themes:\n\n${show('Theme', input.themes)}` : 'Themes: none',
      input.flags.length > 0
        ? `Flags:\n\n${show('Flag', input.flags, input.flags.map(f => f.kind))}` : 'Flags: none',
    ].join('\n\n')

    // A policy decline on Sonnet is retried server-side on a fallback model
    // (`fallbacks: 'default'`); a refusal that still stands is a failed check,
    // so the route keeps what it last showed.
    const response = await client.beta.messages.stream({
      model: CHECK_MODEL,
      max_tokens: CHECK_MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: CHECK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: CHECK_SCHEMA } },
    }).finalMessage()
    if (response.stop_reason === 'refusal') {
      throw new Error('synthesis check: the model declined to answer')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('synthesis check: model response was truncated (max_tokens)')
    }
    const text = response.content.find(b => b.type === 'text')
    if (!text || text.type !== 'text') {
      throw new Error('synthesis check: model response carried no text content block')
    }

    const parsed = JSON.parse(text.text) as { themes?: unknown; flags?: unknown } | null
    if (!Array.isArray(parsed?.themes) || !Array.isArray(parsed.flags)) {
      throw new Error('synthesis check: model response did not match the expected shape')
    }
    // Numbers back to report ids. A group naming nothing that was sent, or a
    // quote number outside its own group, refers to no report at all.
    const back = (groups: CheckInput['themes'], entry: unknown) => {
      const e = entry as { from?: unknown; label?: unknown; quotes?: unknown }
      if (typeof e?.label !== 'string' || !Array.isArray(e.quotes)) {
        throw new Error('synthesis check: model response did not match the expected shape')
      }
      const from = reportIndexOf(e.from) - 1
      const source = groups[from]
      const reportIds = source === undefined ? [] : e.quotes.flatMap((n: unknown) => {
        const id = source.citations[reportIndexOf(n) - 1]?.reportId
        return id === undefined ? [] : [id]
      })
      return { from, label: e.label, reportIds }
    }
    return {
      themes: parsed.themes.map(e => back(input.themes, e)),
      flags: parsed.flags.map(e => {
        const kind = (e as { kind?: unknown } | null)?.kind
        if (typeof kind !== 'string') {
          throw new Error('synthesis check: model response did not match the expected shape')
        }
        return { ...back(input.flags, e), kind }
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// Synthesis, between the two readings: which themes say the same thing?
// ---------------------------------------------------------------------------

/** `themes` are the 1-based numbers the themes were shown with. */
const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, themes: { type: 'array', items: { type: 'integer' } } },
        required: ['label', 'themes'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const

const MERGE_SYSTEM_PROMPT =
  'You are given the themes a reader drew from Italian climbing trip reports about one route or '
  + 'crag, each numbered, with its label and a few of the climbers\' own words behind it. The reader '
  + 'often named one idea several times in other words, which splits the people who said it. Group '
  + 'every set of themes that a climber would read as the same thing, so that it is counted once.\n\n'
  + 'Be generous: synonyms and near-synonyms are one theme. "Chiodatura ravvicinata", "Chiodatura '
  + 'generosa" and "Spit vicini" are one. "Tiri corti" and "Tiri brevi ma intensi" are one. '
  + '"Avvicinamento breve", "Avvicinamento comodo" and "Comoda da raggiungere" are one. The same '
  + 'opinion in other words is one theme too, whatever the adjective: "Roccia buona", "Roccia bella", '
  + '"Roccia ottima" and "Calcare ottimo" are one; "Bel posto", "Bella falesia", "Posto bello" and '
  + '"Falesia piacevole" are one; "Chiodatura ottima", "Chiodatura buona" and "Attrezzatura buona" '
  + 'are one; "Ben curata", "Falesia in ordine" and "Attrezzatura in ordine" are one.\n\n'
  + 'Keep apart only what a climber would read as different: opposite things ("Roccia buona" and '
  + '"Roccia sporca"; "Gradi generosi" and "Gradi stretti"), a fact and an opinion about the same '
  + 'subject ("Chiodatura ravvicinata", how close the bolts are, and "Chiodatura ottima", how good '
  + 'they are), and different facts ("Monotiri" and "Tiri corti"; "Falesia ombrosa" and "Esposizione '
  + 'soleggiata"; a named sector and another). A precise fact is not merged into a broader one: '
  + '"Tiri di media lunghezza" is not "Tiri corti", "Tutti 6a" is not "Gradi giusti", "Tiri puliti" '
  + 'is not "Vie belle". A weaker or stronger opinion is not the same opinion: "Falesia discreta" '
  + '(so-so) is not "Bel posto". Use the quotes to tell what a label means when it is unclear, and '
  + 'when in doubt keep two themes apart.\n\n'
  + 'For each group give the numbers of its themes and the label to keep: one of the group\'s own '
  + 'labels, word for word, the plainest and most general. Return only groups of two or more.'

/**
 * Sonnet, as the check: deciding that two names mean one thing is the same
 * kind of judgment, and Haiku is the step that named them twice. The input is
 * short — a name and a few quotes per theme — so this costs a few cents on the
 * busiest crag. Room for adaptive thinking and a few dozen groups.
 */
const MERGE_MAX_TOKENS = 16000

function mergeThemes(client: Anthropic): MergeThemes {
  return async (input: MergeInput): Promise<MergeResult> => {
    const content = [
      `Route or crag: ${input.itineraryName}`,
      'Themes:',
      input.themes.map((t, i) => [`${i + 1}. ${t.label}`, ...t.quotes.map(q => `   "${q}"`)].join('\n')).join('\n'),
    ].join('\n\n')

    const response = await client.beta.messages.stream({
      model: CHECK_MODEL,
      max_tokens: MERGE_MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: MERGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: MERGE_SCHEMA } },
    }).finalMessage()
    if (response.stop_reason === 'refusal') throw new Error('synthesis merge: the model declined to answer')
    if (response.stop_reason === 'max_tokens') throw new Error('synthesis merge: model response was truncated (max_tokens)')
    const text = response.content.find(b => b.type === 'text')
    if (!text || text.type !== 'text') throw new Error('synthesis merge: model response carried no text content block')

    const parsed = JSON.parse(text.text) as { groups?: unknown } | null
    if (!Array.isArray(parsed?.groups)) throw new Error('synthesis merge: model response did not match the expected shape')
    return {
      // Numbers back to 0-based indices; `applyMerges` drops any out of range.
      groups: parsed.groups.map(entry => {
        const g = entry as { label?: unknown; themes?: unknown }
        if (typeof g?.label !== 'string' || !Array.isArray(g.themes)) {
          throw new Error('synthesis merge: model response did not match the expected shape')
        }
        return { label: g.label, themes: g.themes.map((n: unknown) => reportIndexOf(n) - 1) }
      }),
    }
  }
}

// ---------------------------------------------------------------------------
// Find: rewriting a line the parser could not read
// ---------------------------------------------------------------------------

/**
 * Haiku 5.5, at low effort: turning one short line into another is the
 * smallest job a model does, and Find waits on it. About three hundredths of a
 * cent a call at the prices this was chosen against.
 */
const REWRITE_MODEL = 'claude-haiku-5-5'

/** One line back, plus whatever thinking low effort spends on it. */
const REWRITE_MAX_TOKENS = 2000

/**
 * How long a search waits before answering without the model. Short, because
 * the visitor is looking at a blank page while it runs, and the parser's own
 * answer is always there to fall back on.
 */
const REWRITE_TIMEOUT_MS = 5000

/** Lines already rewritten, so a search that is reloaded or shared is asked once. */
const REWRITE_CACHE_SIZE = 500

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { line: { type: 'string' } },
  required: ['line'],
  additionalProperties: false,
} as const

function rewritePrompt(activities: readonly string[], phrases: readonly string[]): string {
  return `You rewrite a search typed into ${brand().name}, an Italian archive of climbing and mountaineering `
    + 'routes, into the phrasing its search reads. The visitor may write in any language, misspell '
    + 'words, or phrase things freely. Write the line again in Italian, using only these forms:\n'
    + `- an activity, written exactly as one of: ${activities.join(', ')}. "Falaise", "crag" and `
    + '"sport climbing" are Falesia; "alpinisme" and "mountaineering" are Alpinismo.\n'
    + '- a place, under its Italian name and correctly spelled: Torino, not Turin or Torine.\n'
    + '- "entro N km da <place>" for anything about being near or around a place. Use the distance '
    + 'the visitor gave; where they gave none, write "entro 80 km da <place>".\n'
    + '- a grade: "fino a <grade>", "dal <grade> al <grade>", or the grade alone. Alpine grades are '
    + 'F, PD, AD, D, TD, ED, with + or -; sport grades are like 5c, 6a, 6b+, 7a.\n'
    + (phrases.length > 0 ? `- any of these phrases, written exactly: ${phrases.join(', ')}.\n` : '')
    + 'The line as typed found nothing. A place the visitor named may hold no routes itself, as a '
    + 'city does: unless they gave a distance or the place is plainly a crag or a mountain, write '
    + '"entro 80 km da <place>". '
    + 'Keep any other proper name, such as the name of a route or a crag, exactly as typed. Leave out '
    + 'words that ask for nothing. Never add anything the visitor did not ask for. If the line is '
    + 'already in this phrasing, return it unchanged.'
}

/** Wired once at server startup from `ANTHROPIC_API_KEY`. Never constructed in a test. */
export function realRewriteLine(apiKey: string): RewriteLine {
  const client = new Anthropic({ apiKey })
  const cache = new Map<string, string | null>()

  return async (input: RewriteInput): Promise<string | null> => {
    const key = input.line.trim().toLowerCase()
    if (cache.has(key)) return cache.get(key)!

    const response = await client.messages.create({
      model: REWRITE_MODEL,
      max_tokens: REWRITE_MAX_TOKENS,
      system: rewritePrompt(input.activities, input.phrases),
      messages: [{ role: 'user', content: input.line }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REWRITE_SCHEMA } },
    }, { timeout: REWRITE_TIMEOUT_MS, maxRetries: 0 })

    // A refusal or a cut-off answer is no rewrite at all, and says so by being null.
    const block = response.content.find(b => b.type === 'text')
    let line: string | null = null
    if (response.stop_reason === 'end_turn' && block?.type === 'text') {
      const parsed = JSON.parse(block.text) as { line?: unknown }
      if (typeof parsed.line === 'string' && parsed.line.trim() !== '') line = parsed.line.trim().slice(0, 200)
    }

    if (cache.size >= REWRITE_CACHE_SIZE) cache.delete(cache.keys().next().value!)
    cache.set(key, line)
    return line
  }
}
