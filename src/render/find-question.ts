import {
  DRY_OFFERS, dryWritten, findPhrasesOf, gradeSystemOfActivity, type Constraint,
} from '../domain/find/constraints.ts'
import { ACTIVITY_FAMILIES } from '../domain/activities/index.ts'
import { gradeSteps } from '../domain/quantity.ts'
import { gradeBandAttr } from './grade-band.ts'
import { html, join, raw, type Html } from './html.ts'
import { LINE_EXAMPLES, SHOWN_EXAMPLES } from './line-examples.ts'

/** The shape `find` reports its rereading in; declared here so render never imports app. */
export interface FindReading {
  readonly rewritten: string | null
  readonly ignored: string | null
}

export interface QuestionOpts {
  /** Exactly what was typed. */
  readonly query: string
  readonly constraints: readonly Constraint[]
  readonly reading?: FindReading
  /** The open line instead of the sentence: the visitor asked to write freely. */
  readonly free?: boolean
  /** The lines the open line shows in grey, ones this archive answers; by default the first candidates. */
  readonly examples?: readonly string[]
}

/** The distances the near clause offers, beside whatever was asked. */
const RADII = [10, 20, 30, 50, 80, 150]

/**
 * Find's question, in one of its two forms (a design study,
 * section 05).
 *
 * After a search it's a sentence with slots: every constraint the parser found
 * becomes a clause, and every clause a control. The controls are form fields
 * named `p`, each holding its piece *as it would be typed*, so the form posts
 * the line back in words the parser reads — `Falesia`, `entro 30 km da`,
 * `Torino` — and the server joins them. That is why the sentence works with no
 * script at all; find-live.js only makes each change search in place.
 *
 * Asked to write freely, it's the home page's open line instead, holding the
 * line that was searched.
 */
export function question(opts: QuestionOpts): Html {
  return opts.free ? openLine(opts) : slotted(opts)
}

function openLine(opts: QuestionOpts): Html {
  const line = opts.reading?.rewritten ?? opts.query
  const examples = opts.examples ?? LINE_EXAMPLES.slice(0, SHOWN_EXAMPLES)
  return html`<section class="q">
  <form method="get" action="/trova">
    <div class="q__row">
      <label class="q__lead" for="q">Cerco</label>
      <div class="q__line" data-examples="${JSON.stringify(examples)}">
        <input class="q__in" id="q" name="q" type="search" value="${line}" autofocus
         placeholder="${examples[0] ?? ''}">
      </div>
    </div>
    <div class="q__go"><button class="btn" type="submit">Cerca</button>
      <a class="q__back" href="/trova?q=${encodeURIComponent(line)}">Torna alla frase</a></div>
  </form>
</section>`
}

function slotted(opts: QuestionOpts): Html {
  const c = opts.constraints
  if (c.length === 0) {
    return html`<section class="q">
  <p class="q__s">Tutto l’archivio. <a href="/">Scrivi che cosa cerchi.</a></p>
</section>`
  }

  const activity = c.find(x => x.kind === 'activity')
  const clauses: Html[] = [html`Cerco ${activitySlot(activity)}`]
  for (const x of c) {
    if (x.kind === 'fact') clauses.push(factSlot(x))
  }
  for (const x of c) {
    if (x.kind === 'dry') clauses.push(drySlot(x))
  }
  for (const x of c) {
    if (x.kind === 'grade') clauses.push(html`di grado ${gradeSlot(x)}`)
  }
  for (const x of c) {
    if (x.kind === 'near') clauses.push(html`entro ${radiusSlot(x.withinKm)} da ${textSlot(x.placeName, 'Luogo')}`)
    if (x.kind === 'place') clauses.push(html`a ${textSlot(x.name, 'Luogo')}`)
  }
  for (const x of c) {
    if (x.kind === 'name') clauses.push(html`che si chiamano ${textSlot(x.text, 'Nome')}`)
  }

  const free = `/trova?q=${encodeURIComponent(opts.query)}&scrivi=1`
  return html`<section class="q">
  <form class="q__f" method="get" action="/trova">
    <p class="q__s">${join(clauses, ' ')}</p>
    <p class="q__more"><button class="btn" type="submit">Cerca</button>
    ${clearAll(c, activity)}${adders(c, activity)}</p>
  </form>
  <p class="q__n">${notes(opts)} <a class="q__free" href="${free}">scrivi liberamente</a></p>
</section>`
}

type Of<K extends Constraint['kind']> = Extract<Constraint, { kind: K }>

/**
 * One way back to the activity alone: every clause but the activity dropped at
 * once, where taking them off one by one would mean a menu or a tick each.
 * Shown only when there is something besides the activity to take off; with no
 * activity it goes back to the whole archive.
 */
function clearAll(c: readonly Constraint[], activity: Of<'activity'> | undefined): Html {
  if (!c.some(x => x.kind !== 'activity')) return html``
  const label = activity && ACTIVITY_FAMILIES.flatMap(f => f.members).find(a => a.id === activity.id)?.label.it
  const href = label ? `/trova?p=${encodeURIComponent(label)}` : '/trova'
  return html`<a class="q__clear" href="${href}"><span aria-hidden="true">×</span> Azzera filtri</a>
    `
}

/**
 * The activity, as the plural a search asks for. Its value is the label, which
 * is what the parser reads; "itinerari" is no activity at all. An activity Find
 * inferred keeps its dotted mark, since nobody chose it. The activities come
 * in their families, and each says its id, which find-menus.js colours it by,
 * and its bare name, which the open menu lists in place of the plural: the
 * sentence reads `gite di sci alpinismo`, the menu only `Sci alpinismo`.
 */
function activitySlot(current: Of<'activity'> | undefined): Html {
  const groups = ACTIVITY_FAMILIES.map(f => {
    const options = join(f.members.map(a => option(
      a.label.it, a.plural?.it ?? a.label.it.toLowerCase(), a.id === current?.id,
      html` data-act="${a.id}" data-name="${a.label.it}"`)), '\n      ')
    return f.label ? html`<optgroup label="${f.label.it}">${options}</optgroup>` : options
  })
  return html`<select class="${current?.inferred ? 'slot slot--inf' : 'slot'}" name="p" aria-label="Attività">
      ${option('', 'itinerari', current === undefined, raw(' data-name="Tutte le attività"'))}
      ${join(groups, '\n      ')}
    </select>`
}

/** A fact phrase: kept while ticked. Unticking it drops it from the line. */
function factSlot(c: Of<'fact'>): Html {
  return html`<label class="slot slot--x"><input type="checkbox" name="p" value="${c.written}" checked>${c.written}<span class="x" aria-hidden="true">×</span></label>`
}

/**
 * The grade, as its two ends: `dal [6a] al [7b]`. Either end can be left open,
 * and the sentence still reads — `fino al 7b`, `dal 6a in su` — while leaving
 * both open drops the grade. Each
 * menu posts its end as it would be typed, `dal 6a` and `al 7b`, so the line
 * reads back as a range, a floor or a ceiling, whichever ends are set.
 * `data-range` pairs the two for find-menus.js, which draws them as one ruler,
 * and each step carries its grade band where it has one.
 */
function gradeSlot(c: Of<'grade'>): Html {
  const steps = gradeSteps(c.scale)
  const top = steps.length - 1
  const low = steps.map((g, i) => option(`dal ${g}`, `dal ${g}`, c.min > 0 && i === c.min, gradeBandAttr(g)))
  const high = steps.map((g, i) => option(`al ${g}`, `al ${g}`, c.max < top && i === c.max, gradeBandAttr(g)))
  return html`<select class="slot" name="p" aria-label="Grado da" data-range="lo">
      ${option('', 'fino', c.min === 0)}
      ${join(low, '\n      ')}
    </select> <select class="slot" name="p" aria-label="Grado a" data-range="hi">
      ${option('', 'in su', c.max === top)}
      ${join(high, '\n      ')}
    </select>`
}

/** The dry spell asked, among the figures the sentence offers, or none. */
function drySlot(c: Of<'dry'>): Html {
  const days = DRY_OFFERS.includes(c.days) ? DRY_OFFERS : [...DRY_OFFERS, c.days].sort((a, b) => a - b)
  return html`<select class="slot" name="p" aria-label="Pioggia">
      ${option('', 'con o senza pioggia', false)}
      ${join(days.map(d => option(dryWritten(d), dryWritten(d), d === c.days)), '\n      ')}
    </select>`
}

/** The radius; its value carries the words around it so the line reads back. */
function radiusSlot(km: number): Html {
  const radii = RADII.includes(km) ? RADII : [...RADII, km].sort((a, b) => a - b)
  return html`<select class="slot" name="p" aria-label="Distanza">
      ${join(radii.map(r => option(`entro ${r} km da`, `${r} km`, r === km)), '\n      ')}
    </select>`
}

function textSlot(value: string, label: string): Html {
  return html`<input class="slot slot--t" type="text" name="p" value="${value}" size="${String(Math.max(value.length, 3))}" aria-label="${label}">`
}

/**
 * What can still be added, one control per kind of thing: `+ grado`, `+
 * stagione`, `+ al riparo dalla pioggia`. A kind with several values is a menu of them;
 * a kind with one is a button that adds it. Both post their phrase as `p`, so
 * every offer is one the parser reads back, and both are read off the registry.
 * A kind already asked for is not offered again; nothing left, no controls.
 */
function adders(c: readonly Constraint[], activity: Of<'activity'> | undefined): Html {
  if (!activity) return html``
  const controls: Html[] = []

  if (!c.some(x => x.kind === 'dry')) {
    controls.push(addMenu('senza pioggia', DRY_OFFERS.map(d => ({ value: dryWritten(d), text: `da ${d} giorni` }))))
  }

  const system = gradeSystemOfActivity(activity.id)
  if (system && !c.some(x => x.kind === 'grade')) {
    controls.push(addMenu('grado', gradeSteps(system).map(g => ({ value: `dal ${g}`, text: `dal ${g}`, attrs: gradeBandAttr(g) }))))
  }

  const asked = c.filter(x => x.kind === 'fact')
  const byFact = new Map<string, { label: string; values: string[] }>()
  for (const p of findPhrasesOf(activity.id)) {
    // Seasons add up — spring and autumn — so the others stay offered. A fact
    // with one value at a time does not: a wall faces one way, and a second
    // approach limit only contradicts or repeats the first.
    if (asked.some(x => x.id === p.fact && (p.match !== 'includes' || x.value === p.value))) continue
    const group = byFact.get(p.fact)
    if (group) group.values.push(p.written)
    else byFact.set(p.fact, { label: p.label, values: [p.written] })
  }
  for (const { label, values } of byFact.values()) {
    controls.push(values.length === 1
      ? html`<button class="q__add" type="submit" name="p" value="${values[0]!}">+ ${values[0]!}</button>`
      : addMenu(label.toLowerCase(), values.map(v => ({ value: v, text: v }))))
  }

  return join(controls, '\n    ')
}

/** One kind of addition with several values: a menu headed by its name. */
function addMenu(name: string, values: readonly { value: string; text: string; attrs?: Html }[]): Html {
  return html`<select class="q__add" name="p" aria-label="Aggiungi ${name}">
      ${option('', `+ ${name}`, true)}
      ${join(values.map(v => option(v.value, v.text, false, v.attrs)), '\n      ')}
    </select>`
}

/** `attrs` is extra attributes, already built and escaped as Html. */
function option(value: string, text: string, selected: boolean, attrs: Html = raw('')): Html {
  return selected
    ? html`<option value="${value}"${attrs} selected>${text}</option>`
    : html`<option value="${value}"${attrs}>${text}</option>`
}

/**
 * How Find got from the line typed to the sentence shown: a rewrite is tagged
 * and quotes the original, words set aside are named. Followed, in the same
 * line, by the way back to the open line.
 */
function notes(opts: QuestionOpts): Html {
  const parts: Html[] = []
  if (opts.reading?.rewritten) {
    parts.push(html`<span class="q__tag">Riletta</span> <span>Avevi scritto <q>${opts.query}</q></span>`)
  }
  if (opts.reading?.ignored) {
    parts.push(html`<span>Non ho capito <q>${opts.reading.ignored}</q> e l’ho lasciato da parte.</span>`)
  }
  return join(parts, ' ')
}
