import { asset } from './assets.ts'
import type { PhotoRow } from '../db/gita-photo.ts'
import { extFor } from '../app/photo-store.ts'
import { formatShortDate, plural, yearOf } from '../domain/italian.ts'
import { shell, type Viewer } from './shell.ts'
import { html, join, concat, type Html } from './html.ts'
import { creditLinks, reportAuthor, viewerData } from './photo-credit.ts'

export interface PhotosPageOpts {
  readonly itineraryId: string
  readonly itineraryName: string
  readonly photos: readonly PhotoRow[]
  readonly viewer?: Viewer | null
  readonly csrf?: string
  readonly now?: Date
}

/**
 * Every photo standing against one itinerary, newest report first, as one
 * wall: each photo at its own shape, the rows filled edge to edge, the day on
 * the first photo of each report (photos-page-options.html, B). Unpaginated,
 * as `giteFor`'s every standing report is. A photo opens in the same viewer
 * as the report mosaics, which steps through the whole wall; without script,
 * each tile is a link to its own `:target` viewer below.
 */
export function photosPage(opts: PhotosPageOpts): string {
  const now = opts.now ?? new Date()
  const reports = new Set(opts.photos.map(p => p.gitaId)).size
  const last = opts.photos[0]

  return shell({
    title: `Tutte le foto — ${opts.itineraryName}`,
    tab: 'trova',
    viewer: opts.viewer, csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="phead">
    <p class="crumb lab"><a href="/itinerario/${opts.itineraryId}">${opts.itineraryName}</a></p>
    <h1>Tutte le foto</h1>
    ${last ? html`<p class="fcount"><b>${plural(opts.photos.length, 'foto', 'foto')}</b> da ${
      plural(reports, 'relazione', 'relazioni')} · l’ultima il <b>${formatShortDate(last.observedAt)} ${
      yearOf(last.observedAt)}</b></p>` : null}
  </div>
  <main class="doc">
    ${body(opts.photos, opts, now)}
  </main>
</div>
<script type="module" src="${asset('/photo-zoom.js')}"></script>
<script type="module" src="${asset('/gallery-lightbox.js')}"></script>`,
  })
}

function body(photos: readonly PhotoRow[], opts: PhotosPageOpts, now: Date): Html {
  if (photos.length === 0) return html`<p>Nessuna foto ancora.</p>`

  return concat(
    html`<div class="mo wall">${join(photos.map((p, i) =>
      wallTile(p, opts.itineraryId, i === 0 || photos[i - 1]!.gitaId !== p.gitaId)), '')}</div>`,
    // The no-script viewer: one :target box per photo, in the wall's order,
    // so next and previous read the whole archive.
    join(photos.map((p, i) => lightbox(p, photos, i, opts.itineraryName, now)), '\n  '),
  )
}

/** A photo without a size of its own is drawn in a plain 4:3 frame. */
const FALLBACK_RATIO = 4 / 3

/**
 * One photo on the wall, at its own shape (`--r`, its width over its height).
 * The first photo of a report carries the report's day.
 */
function wallTile(p: PhotoRow, itineraryId: string, first: boolean): Html {
  const ratio = p.width && p.height ? p.width / p.height : FALLBACK_RATIO
  const when = `${formatShortDate(p.observedAt)} ${yearOf(p.observedAt)}`
  return html`<a class="mo__t" href="#lb-${p.id}" data-zoom${viewerData(p, itineraryId)} style="--r:${
    ratio.toFixed(3)}"><img src="/foto/${p.id}.${extFor(p.mime)}" alt="${p.caption ?? 'Foto'}" loading="lazy">${
    first ? html`<span class="mo__chip">${when}</span>` : null}</a>`
}

function lightbox(
  p: PhotoRow, all: readonly PhotoRow[], i: number, itineraryName: string, now: Date,
): Html {
  const prev = all[(i - 1 + all.length) % all.length]!
  const next = all[(i + 1) % all.length]!
  const said = p.caption ? html`<b>${p.caption}</b>` : null

  return html`<div id="lb-${p.id}" class="lb" lang="it"><div class="lb__frame">
    <a class="lb__close" href="#" aria-label="Chiudi">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>
    </a>
    <img src="/foto/${p.id}.${extFor(p.mime)}" alt="${p.caption ?? `Foto di ${itineraryName}`}">
    <p class="lb__cap">${said}<span>Foto di ${p.credit?.author ?? reportAuthor(p)} · ${formatShortDate(p.observedAt)} ${yearOf(p.observedAt)}</span>${credited(p)}</p>
    <span class="lb__count">${i + 1} di ${all.length}</span>
    <a class="lb__nav lb__prev" href="#lb-${prev.id}" aria-label="Foto precedente">‹</a>
    <a class="lb__nav lb__next" href="#lb-${next.id}" aria-label="Foto successiva">›</a>
  </div></div>`
}

/** A licensed photo's credit in the viewer, with its links. */
function credited(p: PhotoRow): Html | null {
  const links = creditLinks(p)
  return links ? html`<small class="credit">${links}</small>` : null
}
