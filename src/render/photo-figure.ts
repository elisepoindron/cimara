import type { PhotoRow } from '../db/gita-photo.ts'
import { extFor } from '../app/photo-store.ts'
import { formatRelativeDays } from '../domain/italian.ts'
import { html, type Html } from './html.ts'
import { creditLinks, reportAuthor } from './photo-credit.ts'

/**
 * One photo, however it is captioned — the mockups' figure/figcaption shape,
 * shared by the rail strip and the full gallery page so they never drift apart.
 */
export function photoFigure(p: PhotoRow, itineraryName: string, now: Date): Html {
  const alt = p.caption ?? `Foto di ${itineraryName}`
  const said = p.caption ? html`${p.caption}` : null

  return html`<figure><img src="/foto/${p.id}.${extFor(p.mime)}" alt="${alt}">
            <figcaption>${said}<cite>${reportAuthor(p)}, ${formatRelativeDays(p.observedAt, now)}</cite>${credited(p)}</figcaption></figure>`
}

/** A licensed photo's credit, on a line of its own under the byline. */
function credited(p: PhotoRow): Html | null {
  const links = creditLinks(p)
  return links ? html`<small class="credit">${links}</small>` : null
}
