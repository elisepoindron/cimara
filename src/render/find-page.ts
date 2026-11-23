import { asset } from './assets.ts'
import type { Constraint } from '../domain/find/constraints.ts'
import type { Candidate, Ranked } from '../domain/find/rank.ts'
import { formatAgo } from '../domain/italian.ts'
import { findMap, pinRecap, maplibreHead, type Pin } from './live-map.ts'
import { shell, type Viewer } from './shell.ts'
import { favoriteButton } from './favorite-button.ts'
import { html, join, type Html } from './html.ts'
import { axisOf, type GradeAxis, type RowSlot } from '../domain/row-facts.ts'
import { factsLine, iconSprite } from './facts-line.ts'
import { question, type FindReading } from './find-question.ts'

export interface FindRow {
  readonly ranked: Ranked
  /** "CN Crissolo" — the province code and the comune, as the design sets it. */
  readonly where: string
  readonly activity: string
  /** The facts line, one slot per item the activity's `row` declares. */
  readonly cells: readonly RowSlot[]
  readonly isFavorite: boolean
}

export interface FindPageOpts {
  /** Exactly what was typed, echoed back so a wrong parse is visible. */
  readonly query: string
  readonly constraints: readonly Constraint[]
  readonly rows: readonly FindRow[]
  /** Every route that matched, which is not the same as every row shown. */
  readonly total: number
  /** What Find changed about the question before answering it; absent, nothing was. */
  readonly reading?: FindReading
  /** Show the open line rather than the sentence: the visitor asked to write freely. */
  readonly free?: boolean
  /** The open line's grey examples, ones this archive answers. */
  readonly examples?: readonly string[]
  /** Every match located, for the map. Absent, the map has the rows' own pins. */
  readonly points?: readonly MapPoint[]
  /** Every match with no view, when the list is narrowed to one; what "fuori dalla carta" counts against. */
  readonly totalAll?: number | null
  /** The page shown, from 1, and how many there are. */
  readonly page?: number
  readonly pages?: number
  /** The map's view as the address carried it, `w,s,e,n`: the page links keep it. */
  readonly view?: string | null
  readonly now?: Date
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

export type { FindReading } from './find-question.ts'

/** A pin on Find's map: any match of the question, on the page or not. */
export interface MapPoint {
  readonly id: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly activity: string
  /** The place's own name: the card of a pin that is not on the page says only this and the activity. */
  readonly placeName: string
}

/**
 * The address of this question at `page`, in this view or, with `whole`, on the
 * whole map. Every state of the list is a link, so it works without the script.
 */
function addressOf(opts: FindPageOpts, page: number, whole = false): string {
  const params = new URLSearchParams({ q: opts.query })
  if (opts.view && !whole) params.set('vista', opts.view)
  if (page > 1) params.set('pagina', String(page))
  return `/trova?${params}`
}


/**
 * What a row says about a route's reports, and nothing about what they found:
 * how many there are, and when the last one was. "4 relazioni" means what
 * "Leggi tutte le 4 relazioni" on the route's own page means. A route nobody
 * has written about is one to tell us about.
 */
function reportsOf(c: Candidate, now: Date): { label: string; said: string } {
  if (c.reports === 0) return { label: 'Da raccontare', said: 'nessuna relazione' }
  const label = c.reports === 1 ? '1 relazione' : `${c.reports} relazioni`
  const when = c.lastReportAt === null ? '' : formatAgo(c.lastReportAt, now)
  return { label, said: c.reports === 1 ? when : `l’ultima ${when}` }
}

/** "14 itinerari", and what they were narrowed to. */
function count(total: number, constraints: readonly Constraint[]): string {
  const noun = total === 1 ? 'itinerario' : 'itinerari'
  return constraints.some(c => c.kind === 'near')
    ? `${total} ${noun} in questo raggio`
    : `${total} ${noun}`
}

/**
 * The list's header. On the whole map, how many routes answer. Narrowed to a
 * view that leaves some out, how many are on the map, and how many are off it
 * as one number — never rows — with the way back to all of them.
 */
function listHead(opts: FindPageOpts): Html {
  const off = opts.view && opts.totalAll != null ? opts.totalAll - opts.total : 0
  if (off <= 0) return html`<div class="list__h"><b>${count(opts.total, opts.constraints)}</b></div>`
  const noun = opts.total === 1 ? 'itinerario' : 'itinerari'
  return html`<div class="list__h"><b>${opts.total} ${noun} sulla carta</b><span class="list__out">${off} fuori dalla carta · <a class="list__all" href="${addressOf(opts, 1, true)}">Mostra tutti</a></span></div>`
}

/**
 * Numbered pages under the list: the first and the last, the current one and
 * its neighbours, a gap where pages are skipped. Real links, each with the view.
 */
function pager(opts: FindPageOpts, page: number, pages: number): Html {
  if (pages <= 1) return html``
  const want = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  const items: Html[] = []
  items.push(page > 1
    ? html`<a class="pages__step" rel="prev" href="${addressOf(opts, page - 1)}" aria-label="Pagina precedente">‹</a>`
    : html`<span class="pages__step" aria-hidden="true">‹</span>`)
  let last = 0
  for (const n of want) {
    if (n - last > 1) items.push(html`<span class="pages__gap">…</span>`)
    items.push(n === page
      ? html`<a href="${addressOf(opts, n)}" aria-current="page">${n}</a>`
      : html`<a href="${addressOf(opts, n)}">${n}</a>`)
    last = n
  }
  items.push(page < pages
    ? html`<a class="pages__step" rel="next" href="${addressOf(opts, page + 1)}" aria-label="Pagina successiva">›</a>`
    : html`<span class="pages__step" aria-hidden="true">›</span>`)
  return html`<nav class="pages" aria-label="Pagine">${join(items, '')}</nav>`
}

/** How much has been written, and when, at the end of the row. */
function status(c: Candidate, now: Date): Html {
  const { label, said } = reportsOf(c, now)
  const head = c.reports === 0 ? html`<b>${label}</b>` : html`<b class="said">${label}</b>`
  return html`<div class="r__s">
        ${head}
        <span>${said}</span>
      </div>`
}

function result(row: FindRow, axis: GradeAxis | null, aligned: boolean, now: Date, opts: FindPageOpts): Html {
  const next = addressOf(opts, opts.page ?? 1)

  // The locality sits beside the name and the facts under it, as
  // find-falesia.html draws them. The ranking sentence the design used to show
  // here was taken out; rank still writes it, and nothing reads it now.
  return html`<div class="r" data-id="${row.ranked.candidate.id}">
      <div class="r__bar" style="background:var(--rule)"></div>
      <div><p class="r__n"><a class="r__link" href="/itinerario/${row.ranked.candidate.id}">${row.ranked.candidate.name}</a><small>${row.where}</small></p>
        ${factsLine(row.cells, axis, { aligned })}</div>
      ${status(row.ranked.candidate, now)}
      ${favoriteButton({
        itineraryId: row.ranked.candidate.id, isFavorite: row.isFavorite, next,
        viewer: opts.viewer, csrf: opts.csrf,
      })}
    </div>`
}

/**
 * Find: one sentence, one list, one map.
 *
 * The three levels of precision the design argues about — exploring, being
 * suggested something, looking up a name — go into the same field, because they
 * are the same question asked with different amounts of certainty.
 *
 * The question is drawn by find-question.ts: a sentence with slots, or the
 * open line. The query comes back on every render, in the slots and the notes,
 * and is the most directly visitor-supplied string in this project. It goes
 * through `html` like everything else; there is no `raw` anywhere in this file.
 */
export function findPage(opts: FindPageOpts): string {
  const now = opts.now ?? new Date()
  // Columns line up only when every row declares the same facts. A search that
  // names no activity can return routes and crags together, and aligning those
  // would put a route's grade in the column of a crag's histogram.
  const aligned = opts.rows.length > 0 && opts.rows.every(r => r.activity === opts.rows[0]!.activity)
  const axis = axisOf(opts.rows.map(r => r.cells))

  const listed: Pin[] = opts.rows.map(r => {
    const c = r.ranked.candidate
    const { label, said } = reportsOf(c, now)
    return {
      id: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      activity: r.activity,
      recap: pinRecap(r.activity, r.where, r.cells, {
        tint: null, label, said,
      }),
    }
  })

  // Every match on the map when there are points; a pin on the page has the
  // card its row would give, any other its activity and place.
  const onPage = new Map(listed.map(p => [p.id, p]))
  const pins: Pin[] = opts.points
    ? opts.points.map(p => onPage.get(p.id) ?? {
      id: p.id, name: p.name, lat: p.lat, lon: p.lon, activity: p.activity,
      recap: pinRecap(p.activity, p.placeName, []),
    })
    : listed
  const page = opts.page ?? 1
  const pages = opts.pages ?? 1

  return shell({
    title: 'Trova',
    tab: 'trova',
    viewer: opts.viewer,
    csrf: opts.csrf,
    extraHead: maplibreHead(),
    body: html`<div class="split">
  <div class="col">

${question({ query: opts.query, constraints: opts.constraints, reading: opts.reading, free: opts.free, examples: opts.examples })}

  <div class="${aligned ? 'list list--facts' : 'list'}">
    ${listHead(opts)}
    ${opts.rows.length === 0
      ? html`<p class="r__why">${opts.view ? 'Nessun itinerario in questa parte della carta.' : 'Nessun itinerario risponde a questa domanda.'}</p>`
      : html`${iconSprite()}
    ${join(opts.rows.map(r => result(r, axis, aligned, now, opts)), '\n    ')}`}
    ${pager(opts, page, pages)}
  </div>

  </div>
  ${findMap(pins)}
</div>
<script type="module" src="${asset('/find-live.js')}"></script>
<script type="module" src="${asset('/find-sheet.js')}"></script>`,
  })
}
