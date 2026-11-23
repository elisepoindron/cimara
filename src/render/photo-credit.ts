import type { PhotoRow } from '../db/gita-photo.ts'
import { html, type Html } from './html.ts'
import { formatShortDate, yearOf } from '../domain/italian.ts'

/** Who a report nobody filed here is said to be by. */
export const IMPORTED = 'Importata'

/** Who wrote the report a photo belongs to, as the page names them. */
export const reportAuthor = (p: Pick<PhotoRow, 'authorName'>): string => p.authorName ?? IMPORTED

/**
 * What the photo viewer (photo-zoom.js) says under a photo, as the tile's data
 * attributes (viewer-caption-options.html, R4): the caption; who took the
 * photo, one name only (on a filed report its author, on an imported one the
 * photographer its licence credits, never «Importata»); the licence and the
 * original, only where there is one; and the report's day, with its address.
 */
export function viewerData(p: PhotoRow, itineraryId: string): Html {
  const by = p.credit?.author ?? p.authorName ?? IMPORTED
  const day = `${formatShortDate(p.observedAt)} ${yearOf(p.observedAt)}`
  return html` data-cap="${p.caption ?? ''}" data-by="${by}" data-day="${day}" data-report="/itinerario/${
    itineraryId}/relazioni#relazione-${p.gitaId}"${p.credit
      ? html` data-lic="${p.credit.licence}" data-src="${p.credit.source}"` : null}`
}

/** The same credit with its links: the original, and the licence's own page. */
export function creditLinks(p: Pick<PhotoRow, 'credit'>): Html | null {
  const c = p.credit
  if (!c) return null
  const licence = c.licenceUrl
    ? html`<a href="${c.licenceUrl}" rel="license">${c.licence}</a>` : html`${c.licence}`
  return html`<a href="${c.source}">Foto ${c.author}</a>, ${licence}`
}
