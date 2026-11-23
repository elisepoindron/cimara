import type { ItineraryRow } from '../db/itinerary.ts'
import { ABSENT } from '../domain/facts.ts'
import { accessPoints } from '../domain/geo.ts'
import type { Trail } from '../domain/trail.ts'
import { CRAG_WALK, HIKE_TRACK, parkingMap, pointsMap, type Pin } from './live-map.ts'
import { trackGoal, trackTrail, type TrackPoint } from '../domain/track.ts'
import { html, type Html } from './html.ts'
import { roadPanel } from './access-section.ts'

/**
 * Shape first, colour second: a square with a P for where you leave the car, a
 * triangle for the itinerary's own point — a crag's wall, an alpine route's
 * summit. The map draws the same two, cloned from these rows, so the rows are
 * its legend.
 */
const SQUARE = html`<svg class="pk__ic" viewBox="0 0 24 24" aria-hidden="true"><rect class="pk__sq" x="2" y="2" width="20" height="20" rx="4" stroke="#FFF" stroke-width="1.5"/><path d="M9 17.5V6.5h3.6a3.3 3.3 0 0 1 0 6.6H9" fill="none" stroke="#FFF" stroke-width="2.2"/></svg>`
const TRIANGLE = html`<svg class="pk__ic" viewBox="0 0 24 24" aria-hidden="true"><path class="pk__tri" d="M12 2.5 22.5 21.5H1.5Z" stroke="#FFF" stroke-width="1.5" stroke-linejoin="round"/></svg>`

function row(
  kind: 'p' | 'f' | 'v', icon: Html, label: string,
  lat: number | null, lon: number | null, href: (lat: number, lon: number) => string, linkText: string,
): Html {
  const where = lat !== null && lon !== null
    ? html`<span>${lat}, ${lon}</span><a href="${href(lat, lon)}" target="_blank" rel="noopener">${linkText}</a>`
    : html`<span>${ABSENT}</span>`
  return html`<div class="pk__${kind}"><dt>${icon}${label}</dt><dd>${where}</dd></div>`
}

const directions = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
const search = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`

/**
 * A crag's Come arrivare panel: two named points above a map of both, then
 * the road in words. Always drawn on a crag, like the guidebook facts: a point
 * nobody recorded reads as a dash.
 */
export function cragPoints(
  it: ItineraryRow, approach: string | null,
  opts: { sectionId: string; label: string; point?: { it: string; of: string } },
  trail: Trail | null = null,
  around: readonly Pin[] = [],
  road: Html = html``,
): Html {
  const { parking, own: crag } = accessPoints(it)
  const point = opts.point ?? { it: 'Falesia', of: 'della falesia' }
  const map = pointsMap(parking, crag, it.name, approach, parking && crag ? trail : null, around,
    { ...CRAG_WALK, aria: `Mappa del parcheggio e ${point.of}` })

  return html`<section id="${opts.sectionId}">
        <h2>${opts.label}</h2>
        <dl class="pk__pts">${row('p', SQUARE, 'Parcheggio', it.parkingLat, it.parkingLon, directions, 'Indicazioni →')}
          ${row('f', TRIANGLE, point.it, crag?.lat ?? null, crag?.lon ?? null, search, 'Mappa →')}</dl>
        ${map ?? html``}
        ${road}
      </section>`
}

/**
 * An alpine route's Come arrivare panel: the same two rows and shapes as a
 * crag's, the second named for what an alpine route stores — its summit — then
 * the road in words. Where nobody recorded the parking spot the points and the
 * map are left out and the words stay, in the same place. No line joins the
 * two: an alpine approach is prose, not a time, so there is nothing to label
 * it with, and a straight line across a mountain says less than the distance
 * the map already shows.
 */
export function alpinePoints(
  it: ItineraryRow, opts: { sectionId: string; label: string }, around: readonly Pin[] = [],
  road: Html = html``,
): Html {
  const { parkingLat, parkingLon } = it
  if (parkingLat === null || parkingLon === null) return roadPanel(opts, road)

  return html`<section id="${opts.sectionId}">
        <h2>${opts.label}</h2>
        <dl class="pk__pts">${row('p', SQUARE, 'Parcheggio', parkingLat, parkingLon, directions, 'Indicazioni →')}
          ${row('v', TRIANGLE, 'Vetta', it.lat, it.lon, search, 'Mappa →')}</dl>
        ${parkingMap(parkingLat, parkingLon, it.name, it.lat, it.lon, around)}
        ${road}
      </section>`
}

/**
 * A hike's Come arrivare panel where the route has a track: drawn as a crag's,
 * the two rows and the map, then the road in words. The square is where the
 * track starts, the triangle where it goes highest — the goal, whether the
 * track ends there or comes down another way — and the line is the track
 * itself, solid, with its length and climb under the map.
 */
export function trackPoints(
  points: readonly TrackPoint[], name: string, opts: { sectionId: string; label: string },
  around: readonly Pin[] = [],
  road: Html = html``,
): Html {
  const [startLon, startLat] = points[0]!
  const [goalLon, goalLat] = trackGoal(points)
  const start = { lat: startLat, lon: startLon }
  const goal = { lat: goalLat, lon: goalLon }
  const map = pointsMap(start, goal, name, null, trackTrail(points), around, HIKE_TRACK)

  return html`<section id="${opts.sectionId}">
        <h2>${opts.label}</h2>
        <dl class="pk__pts">${row('p', SQUARE, 'Partenza', start.lat, start.lon, directions, 'Indicazioni →')}
          ${row('v', TRIANGLE, 'Meta', goal.lat, goal.lon, search, 'Mappa →')}</dl>
        ${map ?? html``}
        ${road}
      </section>`
}
