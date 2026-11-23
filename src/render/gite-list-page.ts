import type { GitaRow } from '../db/gita.ts'
import type { Flag, FlagKind, SynthesisRow, ThemeCount } from '../db/synthesis.ts'
import { formatShortDate, yearOf } from '../domain/italian.ts'
import { CHANGES_NAMED_FROM, SHARED_VOICES } from '../app/synthesis.ts'
import { shell, type Viewer } from './shell.ts'
import { NOTHING_SHARED } from './synthesis-box.ts'
import type { PhotoRow } from '../db/gita-photo.ts'
import { slipMosaic } from './photo-mosaic.ts'
import { IMPORTED } from './photo-credit.ts'
import { concat, html, join, type Html } from './html.ts'

export interface GiteListPageOpts {
  readonly itineraryId: string
  readonly itineraryName: string
  readonly gite: readonly GitaRow[]
  /**
   * What the reading of these reports kept: the themes each report was counted
   * in, and the lasting changes it records. `null` (no
   * key, too few reports, or not read yet) leaves every slip at its date, its
   * author and its words.
   */
  readonly synthesis?: SynthesisRow | null
  /**
   * The theme picked in the index (`?tema=`), by its label. Only the reports
   * in it are shown. A label the reading does not have shows every report.
   */
  readonly theme?: string | null
  /** The same for a change, Attenzione or Novità (`?cambio=`). */
  readonly change?: string | null
  /**
   * Every standing photo on the route, as `photosFor` returns them; each
   * report shows its own under its words. Imported reports have none.
   */
  readonly photos?: readonly PhotoRow[]
  readonly now?: Date
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

/**
 * Every report on one route, in the order the caller already sorted them —
 * `giteFor` returns most-recent first, with retractions excluded — each as a
 * slip: the date down a narrow stub, the words in full beside it, and under
 * them what the reading kept. How the day was is not pulled out: that is the
 * sky's job, on the route page.
 */
export function giteListPage(opts: GiteListPageOpts): string {
  const read = readingOf(opts.synthesis ?? null)
  const index = readingIndex(opts)
  const picked = index?.picked ?? null
  const shown = picked ? opts.gite.filter(g => picked.ids.has(g.id)) : opts.gite
  const body = opts.gite.length === 0
    ? html`<p>Nessuna relazione depositata.</p>`
    : html`${index?.html ?? null}<div class="slips">
      ${join(shown.map(g => slip(g, read, opts, picked)), '\n      ')}
    </div>`

  return shell({
    title: 'Tutte le relazioni',
    tab: 'trova',
    viewer: opts.viewer,
    csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="phead">
    <p class="crumb lab"><a href="/itinerario/${opts.itineraryId}">${opts.itineraryName}</a></p>
    <h1>Tutte le relazioni</h1>
  </div>
  <main class="doc">
    ${body}
  </main>
</div>`,
  })
}

/** The page, or the page showing only one theme's (`tema`) or one change's (`cambio`) reports. */
function pageHref(itineraryId: string, pick?: { by: 'tema' | 'cambio'; label: string }): string {
  return `/itinerario/${itineraryId}/relazioni${pick ? `?${pick.by}=${encodeURIComponent(pick.label)}` : ''}`
}

/** How many shared themes the index shows before folding the rest. */
const SHARED_IN_VIEW = 10

/** How many changes of each kind it shows before folding the rest. */
const CHANGES_IN_VIEW = 3

/** A theme or a change in the index, and the reports on this page behind it. */
interface Indexed {
  readonly label: string
  readonly kind: FlagKind | 'theme'
  readonly ids: ReadonlySet<string>
}

/**
 * What the reading kept, above the reports. First every theme: the shared ones
 * counted, most reports first — the list the route page's box opens with, but
 * all of it — then the ones only one person has raised, named and never
 * counted, as on the slips. Then what changed at the place, care then news, as
 * the box draws it: how many reports say it and when it was last said, the
 * most recently said first, but every one of them rather than three.
 *
 * Each name is a link that reloads the page with only its reports — no script,
 * an address that can be shared, undone by going back. A count is of the
 * reports on this page, so a report withdrawn since the reading is not in it,
 * and picking a name shows exactly that many.
 *
 * See a design study, option A. Past ten
 * shared themes the rest fold away, and the one-voice ones are folded whole:
 * a design study, option A.
 */
function readingIndex(opts: GiteListPageOpts): { html: Html; picked: Indexed | null } | null {
  const synthesis = opts.synthesis ?? null
  if (!synthesis) return null
  const observed = new Map(opts.gite.map(g => [g.id, g.observedAt]))
  const onPage = (ids: readonly string[]) => new Set(ids.filter(id => observed.has(id)))

  const themes = synthesis.themes.map(t => ({
    label: t.label, kind: 'theme' as const, shared: isShared(t), ids: onPage(t.reportIds),
  })).filter(t => t.ids.size > 0 && t.label.trim() !== '')
  // A change saved by an earlier reading has no name, only its sentence; it
  // waits for the next reading, as on the route page.
  const changes = (synthesis.reading < CHANGES_NAMED_FROM ? [] : synthesis.flags).map(f => {
    const ids = onPage(f.reportIds)
    const last = [...ids].map(id => observed.get(id)!).sort().at(-1) ?? ''
    return { label: f.label, kind: f.kind, ids, last }
  }).filter(c => c.ids.size > 0 && c.label.trim() !== '')
    .sort((a, b) => b.last.localeCompare(a.last) || b.ids.size - a.ids.size)

  const picked: Indexed | null = (opts.theme ? themes.find(t => t.label === opts.theme) : undefined)
    ?? (opts.change ? changes.find(c => c.label === opts.change) : undefined) ?? null
  const shared = themes.filter(t => t.shared).sort((a, b) => b.ids.size - a.ids.size)
  // Ten shared themes in view, the rest a fold away. The ones one person raised
  // are not listed: they show on their own report, where one voice belongs, and
  // a line counting them said nothing a reader could use. A fold holding the
  // picked theme opens, so what filters the page is in view.
  const first = shared.slice(0, SHARED_IN_VIEW)
  const rest = shared.slice(SHARED_IN_VIEW)
  const sharedRow = (t: Indexed) => link(t, html`<b>${String(t.ids.size)}</b><span>${t.label}</span>`)
  // The picked name links back to every report: pressing it again undoes the
  // filter, and its cross says so.
  const link = (t: Indexed, inner: Html) => t === picked
    ? html`<a href="${pageHref(opts.itineraryId)}" class="on" aria-current="true" title="Togli il filtro">${inner}<i class="tidx__x" aria-hidden="true">×</i></a>`
    : html`<a href="${pageHref(opts.itineraryId, { by: t.kind === 'theme' ? 'tema' : 'cambio', label: t.label })}">${inner}</a>`

  // Three of each kind in view, the most recently said, the rest a fold away,
  // care and news side by side: a crag with many changes no longer pushes the
  // reports out of sight.
  const changeRow = (c: Indexed & { last: string }) => html`<div><b>${String(c.ids.size)}</b><span>${link(c, html`${c.label}`)}</span><small>${
    `${formatShortDate(c.last)} ${yearOf(c.last)}`}</small></div>`
  const changeGroups = FLAG_TITLES.flatMap(([kind, title]) => {
    const of = changes.filter(c => c.kind === kind)
    if (of.length === 0) return []
    const more = of.slice(CHANGES_IN_VIEW)
    return [html`<div class="sum__g sum__g--${kind}">
        <div class="sum__gh"><span></span><span>${title}</span><span>ultima volta</span></div>
        ${join(of.slice(0, CHANGES_IN_VIEW).map(changeRow), '')}${more.length > 0 ? html`
        <details class="tidx__more"${more.some(c => c === picked) ? html` open` : null}><summary><span class="tidx__closed">${
          more.length === 1 ? 'Un’altra' : `Altre ${more.length}`}</span><span class="tidx__open">Meno</span></summary>
          ${join(more.map(changeRow), '')}
        </details>` : null}
      </div>`]
  })

  // Nothing shared and nothing changed — a reading of a few reports, each
  // raising its own points — leaves the list empty. The box stays and says so,
  // in the route page's own words, rather than standing empty: those points
  // show on their own slips, and an address that picks one (`?tema=`) still
  // filters. See a design study, option B.
  if (shared.length === 0 && changeGroups.length === 0) {
    return { picked, html: html`<div class="tidx" role="navigation" aria-label="Temi e segnalazioni">
      <p class="tidx__wait">${NOTHING_SHARED}</p>
    </div>` }
  }

  return {
    picked,
    html: html`<div class="tidx" role="navigation" aria-label="Temi e segnalazioni">
      ${shared.length > 0 ? html`<div class="tidx__h"><span>Citato</span><span>da quante relazioni</span></div>
      <div class="tidx__l">${join(first.map(sharedRow), '')}</div>${rest.length > 0 ? html`
      <details class="tidx__more"${rest.some(t => t === picked) ? html` open` : null}><summary><span class="tidx__closed">${
        rest.length === 1 ? 'Un altro tema condiviso' : `Altri ${rest.length} temi condivisi`}</span><span class="tidx__open">Meno temi</span></summary>
        <div class="tidx__l">${join(rest.map(sharedRow), '')}</div>
      </details>` : null}` : null}
      ${changeGroups.length > 0 ? html`<div class="tidx__chg">${join(changeGroups, '')}</div>` : null}
    </div>`,
  }
}

interface Reading {
  readonly themesOf: (reportId: string) => readonly ThemeCount[]
  readonly flagsOf: (reportId: string) => readonly Flag[]
}

/** A stretch of a report's words to mark, and how: the sentence of a lasting
 * change, by its kind, or the words a theme quoted to count the report in it. */
interface Marking {
  readonly text: string
  readonly kind: FlagKind | 'theme'
  /** Shared with the name in the foot, so pointing at either lights both. */
  readonly key: number
}

/** One thing the reading kept about this report: a change or a theme, its name,
 * the words it was read from, and the key that pairs the two on the slip. */
interface Kept {
  readonly label: string
  readonly kind: FlagKind | 'theme'
  readonly quote: string | undefined
  readonly key: number
  /** For a theme: raised by two people or more. */
  readonly shared?: boolean
}

/** Shared from two voices. A theme from an earlier reading has no voices; it
 * was kept only when two reports shared it, so its count stands in. */
function isShared(t: ThemeCount): boolean {
  return (t.voices ?? t.count) >= SHARED_VOICES
}

/** How each kind of change is named on a slip. Care first, then news. */
const FLAG_TITLES: readonly [FlagKind, string][] = [['attenzione', 'Attenzione'], ['novita', 'Novità']]

/** The synthesis turned around: by report rather than by theme. */
function readingOf(synthesis: SynthesisRow | null): Reading {
  const flags = synthesis?.flags ?? []
  const themes = synthesis?.themes ?? []
  return {
    themesOf: id => themes.filter(t => t.reportIds.includes(id)),
    flagsOf: id => flags.filter(f => f.reportIds.includes(id)),
  }
}


/**
 * One report. An imported one has no author here, so it is named as what it is
 * rather than left blank.
 */
function slip(g: GitaRow, read: Reading, opts: GiteListPageOpts, picked: Indexed | null): Html {
  const who = g.authorName ?? IMPORTED
  const flags = read.flagsOf(g.id)
  // Care first, then news, then themes: the order of the foot, and of who wins
  // where two quotes overlap in the words.
  const kept: Kept[] = [
    ...FLAG_TITLES.flatMap(([kind]) => flags.filter(f => f.kind === kind)
      .map(f => ({ label: f.label, kind, quote: f.quotes[g.id] }))),
    ...[true, false].flatMap(shared => read.themesOf(g.id).filter(t => isShared(t) === shared)
      .map(t => ({ label: t.label, kind: 'theme' as const, quote: t.quotes?.[g.id], shared }))),
  ].map((k, i) => ({ ...k, key: i + 1 }))

  // A tag is focusable so a tap on a phone, or the keyboard, lights its words
  // as a pointer does: the pairing is pure CSS (`:has`), no script.
  // The theme or change picked in the index is underlined where the slip names it.
  const tag = (k: Kept, cls: string, extra: Html | null = null, title?: string) =>
    html`<span class="${picked && k.kind === picked.kind && k.label === picked.label ? `${cls} ${cls}--on` : cls}" data-k="${String(k.key)}" tabindex="0"${title ? html` title="${title}"` : null}>${extra}${k.label}</span>`
  // The foot is one row of tags (mobile-options.html, V1 and T2): first what
  // the reading kept as a change, in its colour and named by the change itself
  // — never "Attenzione", which read as a section's name — then the themes, the
  // ones only this report has raised so far drawn apart and never counted.
  const tags = [
    ...FLAG_TITLES.flatMap(([kind, title]) => kept.filter(k => k.kind === kind)
      .map(k => tag(k, `slip__tag slip__tag--${kind} slip__change`, FLAG_ICON[kind], title))),
    ...kept.filter(k => k.kind === 'theme' && k.shared).map(k => tag(k, 'slip__tag slip__theme')),
    ...kept.filter(k => k.kind === 'theme' && !k.shared).map(k => tag(k, 'slip__tag slip__tag--lone slip__theme', null, 'Per ora solo qui')),
  ]
  // Only a change that asks for care colours the slip; news leaves it as it is.
  const care = flags.some(f => f.kind === 'attenzione')
  const initial = g.authorName?.trim().charAt(0).toUpperCase() ?? ''

  return html`<article class="slip slip--v1${care ? ' slip--flag' : ''}" id="relazione-${g.id}">
        <span class="${g.authorName ? 'slip__av' : 'slip__av slip__av--none'}" aria-hidden="true">${initial}</span>
        <div class="slip__main">
          <p class="slip__h"><b class="slip__who">${who}</b><span class="slip__d">${formatShortDate(g.observedAt)} <small>${yearOf(g.observedAt)}</small></span></p>
          <p class="slip__words">${marked(g.words,
            kept.flatMap(k => k.quote ? [{ text: k.quote, kind: k.kind, key: k.key }] : []))}</p>
          ${slipMosaic((opts.photos ?? []).filter(p => p.gitaId === g.id), {
            itineraryId: opts.itineraryId, itineraryName: opts.itineraryName, now: opts.now ?? new Date(),
          })}
          ${tags.length > 0 ? html`<div class="slip__tags">${join(tags, '')}</div>` : null}
          ${withdraw(g, opts)}
        </div>
      </article>`
}

/** A change's kind, said by an icon on its tag: a triangle for care, a spark for news. */
const FLAG_ICON: Readonly<Record<FlagKind, Html>> = {
  attenzione: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 17.6v.4"/></svg>`,
  novita: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>`,
}

/**
 * The words, with each marking set where it first stands in them. A change that
 * asks for care goes first, then news, then themes, so a theme's quote inside a
 * flagged sentence is not marked twice; a marking that overlaps one already
 * placed, or is not in the words, is skipped.
 */
function marked(words: string, markings: readonly Marking[]): Html {
  const placed: { at: number; end: number; kind: Marking['kind']; key: number }[] = []
  for (const m of markings) {
    const at = words.indexOf(m.text)
    if (at < 0 || m.text === '') continue
    const end = at + m.text.length
    if (placed.some(p => at < p.end && p.at < end)) continue
    placed.push({ at, end, kind: m.kind, key: m.key })
  }
  placed.sort((a, b) => a.at - b.at)

  const parts: Html[] = []
  let from = 0
  for (const p of placed) {
    parts.push(html`${words.slice(from, p.at)}`)
    const text = words.slice(p.at, p.end)
    const key = String(p.key)
    parts.push(p.kind === 'attenzione' ? html`<mark data-k="${key}">${text}</mark>`
      : html`<mark class="${p.kind === 'novita' ? 'slip__n' : 'slip__q'}" data-k="${key}">${text}</mark>`)
    from = p.end
  }
  parts.push(html`${words.slice(from)}`)
  return concat(...parts)
}

/**
 * The author's own way to take a report back, under the report itself.
 * Withdrawing adds a retraction and never deletes the gita.
 *
 * Only for the person who filed it, and only with a token to sign the POST:
 * a form nobody can sign is a button that only ever produces a 403. An
 * imported report has no account behind it and nothing to withdraw.
 */
function withdraw(g: GitaRow, opts: GiteListPageOpts): Html | null {
  const viewer = opts.viewer
  if (g.accountId === null || !viewer || !opts.csrf || viewer.id !== g.accountId) return null
  return html`<form class="ritira" method="post" action="/gita/${g.id}/ritira">
            <input type="hidden" name="csrf" value="${opts.csrf}">
            <button type="submit">Ritira la mia relazione</button>
          </form>`
}

/** What an imported report is called where a filed one shows its author. */
export { IMPORTED } from './photo-credit.ts'
