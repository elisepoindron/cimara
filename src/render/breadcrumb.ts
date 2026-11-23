import type { ActivitySchema } from '../domain/registry.ts'
import type { PlaceRow } from '../db/place.ts'
import { html, join, type Html } from './html.ts'

/**
 * Falesia / Piemonte / TO / Bussoleno. The activity first, then place, root
 * first. Each segment is a question put to Find: the activity alone, or the
 * activity in that place.
 *
 * `lines` holds the line for each place Find reads back as that place (see
 * `crumbLines`); a place without one stays plain text, because a breadcrumb —
 * the page's primary navigation — must not offer a control that answers a
 * different question. The activity is always a link: the registry declares it.
 */
export function breadcrumb(
  activity: ActivitySchema, places: readonly PlaceRow[],
  lines: ReadonlyMap<string, string> = new Map(),
): Html {
  const segments = [
    html`<a href="${findHref(activity.label.it)}">${activity.label.it}</a>`,
    ...places.map(p => {
      const line = lines.get(p.id)
      return line === undefined ? html`${p.name}` : html`<a href="${findHref(line)}">${p.name}</a>`
    }),
  ]
  return html`<div class="crumb lab">${join(segments, ' / ')}</div>`
}

function findHref(line: string): string {
  return `/trova?q=${encodeURIComponent(line)}`
}
