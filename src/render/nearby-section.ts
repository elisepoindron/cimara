import type { NearbyRoute } from '../db/itinerary.ts'
import { formatAge, formatRelativeDays } from '../domain/italian.ts'
import { ASPECT_LABELS } from '../domain/quantity.ts'
import { activityOf } from '../domain/activities/index.ts'
import { html, join, type Html } from './html.ts'
import type { Pin } from './live-map.ts'

/** The design shows three; the rest are a search away. */
export const NEARBY_SHOWN = 3

/**
 * Routes nearby with the same aspect, each with how recently it was reported:
 * a link to someone else's fresh report, never a verdict on this one. Drawn in
 * the `.near` cross-link style the mockups already had.
 *
 * Null when there is nothing nearby, so the page does not carry an empty heading.
 */
export function nearbySection(
  routes: readonly NearbyRoute[], opts: { sectionId: string; label: string; now: Date },
): Html | null {
  if (routes.length === 0) return null

  const rows = routes.slice(0, NEARBY_SHOWN).map(r => html`<a href="/itinerario/${r.id}"><span><span class="near__n">${r.name}</span><span class="near__m">${meta(r)}</span></span><span class="near__d">${recency(r, opts.now)}</span></a>`)

  return html`<section id="${opts.sectionId}">
        <h2>${opts.label}</h2>
        <div class="near">
          ${join(rows, '\n          ')}
        </div>
      </section>`
}

/** "2 km · sud · 640 m", leaving out what the route does not declare. */
function meta(r: NearbyRoute): string {
  return [distance(r), r.aspect && ASPECT_LABELS[r.aspect].toLowerCase(), r.altMax !== null && `${r.altMax} m`]
    .filter(Boolean).join(' · ')
}

/**
 * "3 relazioni, l’ultima ieri" · "1 relazione, sabato" · "nessuna da tre mesi"
 * · "nessuna relazione". Counts are of the activity's own window; the date is
 * the newest report of any age.
 */
export function recency(r: NearbyRoute, now: Date): string {
  if (r.lastReportAt === null) return 'nessuna relazione'
  if (r.recent === 0) return `nessuna da ${formatAge(r.lastReportAt, now)}`
  const when = formatRelativeDays(r.lastReportAt, now)
  return r.recent === 1 ? `1 relazione, ${when}` : `${r.recent} relazioni, l’ultima ${when}`
}

/**
 * The same neighbours as pins for the page's map, each card saying what the
 * section's rows say — how far, and how recently someone wrote about it —
 * and never a verdict. A pin is coloured by its activity, which is this
 * page's own: the map shows the other crags around a crag, the other alpine
 * routes around an alpine route.
 */
export function aroundPins(routes: readonly NearbyRoute[], activity: string, now: Date): Pin[] {
  const kind = activityOf(activity).label.it
  return routes.map(r => ({
    id: r.id, name: r.name, lat: r.lat, lon: r.lon, activity,
    recap: { kind, where: '', facts: [
      { label: 'Distanza', text: distance(r) },
      { label: 'Relazioni', text: recency(r, now) },
    ] },
  }))
}

function distance(r: NearbyRoute): string {
  return r.distanceM < 1000 ? 'meno di 1 km' : `${Math.round(r.distanceM / 1000)} km`
}
