import { asset } from './assets.ts'
import type { PhotoRow } from '../db/gita-photo.ts'
import { extFor } from '../app/photo-store.ts'
import { formatShortDate, yearOf } from '../domain/italian.ts'
import { html, join, raw, type Html } from './html.ts'
import { viewerData } from './photo-credit.ts'

export interface MosaicOpts {
  readonly itineraryId: string
  readonly itineraryName: string
  readonly now: Date
}

/** How many photos a report's mosaic shows before the last one counts the rest. */
const IN_SLIP = 5
/** And the rail's: the newest wide, two under it. */
const IN_RAIL = 3

/**
 * A report's photos as one rounded block: the first large, up to four beside
 * it, the last counting any more (report-photos-options.html, P1). Every photo
 * is in the block, the ones past the fifth hidden, so the viewer steps through
 * all of them; captions sit on the photos.
 */
export function slipMosaic(photos: readonly PhotoRow[], opts: MosaicOpts): Html | null {
  if (photos.length === 0) return null
  const n = Math.min(photos.length, IN_SLIP)
  return html`<div class="mo mo--${String(n)}">${tiles(photos, n, opts, p => p.caption)}</div>${script()}`
}

/**
 * The rail's block: the newest photo wide with its date on it, two under it,
 * the last counting the rest (report-photos-options.html, R1). The viewer
 * steps through every photo on the route, not just the three in view. The
 * counting tile is the way to the photos page: it is the section's only link
 * there, since the count line under the block went (photos-footer-options.html).
 */
export function railMosaic(photos: readonly PhotoRow[], opts: MosaicOpts): Html | null {
  if (photos.length === 0) return null
  const n = Math.min(photos.length, IN_RAIL)
  return html`<div class="mo mo--rail mo--rail${String(n)}">${tiles(photos, n, opts,
    (p, i) => i === 0 ? `${formatShortDate(p.observedAt)} ${yearOf(p.observedAt)}` : null,
    `/itinerario/${opts.itineraryId}/foto`)}</div>${script()}`
}

/** The viewer, once per page however many blocks ask for it: a module script runs once per URL. */
const script = (): Html => html`<script type="module" src="${asset('/photo-zoom.js')}"></script>`

function tiles(
  photos: readonly PhotoRow[], shown: number, opts: MosaicOpts,
  label: (p: PhotoRow, i: number) => string | null,
  all?: string,
): Html {
  const rest = photos.length - shown
  return join(photos.map((p, i) => {
    const said = i < shown ? label(p, i) : null
    const counts = i === shown - 1 && rest > 0
    const more = counts ? html`<b class="mo__more" aria-hidden="true">+${String(rest)}</b>` : null
    // On a phone the rail's block opens into a wall of every photo, the day on
    // each report's first one (mobile-options.html, FB). Those days are drawn
    // here and shown only there: the desktop's block keeps its single date.
    const starts = all !== undefined && !said && (i === 0 || photos[i - 1]!.gitaId !== p.gitaId)
    const phoneDay = starts ? html`<span class="mo__chip mo__chip--phone">${formatShortDate(p.observedAt)} ${yearOf(p.observedAt)}</span>` : null
    return tile(p, opts, i >= shown, html`${said ? html`<span class="mo__chip">${said}</span>` : null}${phoneDay}${more}`,
      counts && all ? { href: all, total: photos.length } : null)
  }), '')
}

/**
 * One photo. Without script it is a link to the gallery, opened at this
 * photo's viewer (`/foto#lb-…`), which works on `:target` alone; with
 * `photo-zoom.js` the photo grows out of where it sits instead. A tile given
 * `all` counts the rest and leads to the whole gallery instead: `data-all`
 * tells the viewer to let that click through, while the tile stays in the
 * block's sequence so the arrows still reach its photo.
 */
function tile(p: PhotoRow, opts: MosaicOpts, hidden: boolean, over: Html,
              all: { href: string, total: number } | null = null): Html {
  const alt = p.caption ?? `Foto di ${opts.itineraryName}`
  const href = all ? all.href : `/itinerario/${opts.itineraryId}/foto#lb-${p.id}`
  const toAll = all ? html` data-all aria-label="Vedile tutte, ${String(all.total)} foto"` : null
  return html`<a class="mo__t" href="${href}" data-zoom${toAll}${viewerData(p, opts.itineraryId)}${hidden ? raw(' hidden') : null}><img src="/foto/${p.id}.${
    extFor(p.mime)}" alt="${alt}" loading="lazy">${over}</a>`
}
