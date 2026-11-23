import { asset } from './assets.ts'
import { html, join, raw, type Html } from './html.ts'
import { activityOf } from '../domain/activities/index.ts'
import type { RowSlot } from '../domain/row-facts.ts'
import { halfwayAlong, walkMinutes, type Trail } from '../domain/trail.ts'

/** A route on the map — or, on Find's map, one graded a moment ago. */
export interface Pin {
  readonly id: string
  readonly name: string
  readonly lat: number | null
  readonly lon: number | null
  /**
   * The activity's id, which picks the pin's colour (`--act-<id>` in
   * app.css). A pin is coloured by what kind of route it is, never by its
   * conditions: those are said in words on the list and on the pin's card.
   */
  readonly activity: string
  /** What the card over a clicked pin says, before the visitor goes to the route. */
  readonly recap?: PinRecap
}

/** One fact on a pin's card, already in the words a climber reads. */
export interface PinFact {
  readonly label: string
  readonly text: string
}

/**
 * The card a clicked pin opens: every string already written, so the client
 * only places text and never formats a grade or a count of its own. `state`
 * is Find's alone — home plots its sample ungraded, and a card that said
 * nothing is known about a route nobody asked about would be wrong.
 */
export interface PinRecap {
  /** The activity's own label: "Alpinismo". */
  readonly kind: string
  /** "CN Crissolo", as the Find row beside it says. */
  readonly where: string
  readonly facts: readonly PinFact[]
  readonly state?: {
    /** A colour for the words, or null. Always null since conditions stopped
     * being graded: the card says how many reports, never what they found. */
    readonly tint: string | null
    readonly label: string
    readonly said: string
  }
}

/** How many facts a card has room for, in the order the activity's row declares them. */
const CARD_FACTS = 3

/**
 * A card's facts out of the same row cells a Find row prints, in the same
 * order: a crag's grade histogram becomes its range, since a card has no room
 * for bars, and a distance is printed the way the row prints it.
 */
export function pinFacts(cells: readonly RowSlot[]): PinFact[] {
  const facts: PinFact[] = []
  for (const c of cells) {
    if (c === null) continue
    if (c.kind === 'fact') facts.push({ label: c.label, text: c.text })
    else if (c.kind === 'distance') facts.push({ label: 'Distanza', text: `${c.km.toFixed(0)} km` })
    else if (c.kind === 'grades') facts.push({ label: c.label, text: c.grades.map(g => `${g.it} ${g.grade}`).join(', ') })
    else if (c.counts.length > 0) {
      const low = c.counts[0]!.grade
      const high = c.counts[c.counts.length - 1]!.grade
      facts.push({ label: 'Gradi', text: low === high ? low : `${low}–${high}` })
    }
  }
  return facts.slice(0, CARD_FACTS)
}

/** A pin's card from what its row already knows: the activity's id, its locality and its row cells. */
export function pinRecap(
  activity: string, where: string, cells: readonly RowSlot[], state?: PinRecap['state'],
): PinRecap {
  return { kind: activityOf(activity).label.it, where, facts: pinFacts(cells), ...(state ? { state } : {}) }
}

/**
 * MapLibre's own stylesheet — added to `ShellOpts.extraHead` by each page that
 * actually draws a map (`home-page.ts`, `find-page.ts`, and `itinerary-page.ts`
 * when the route or crag has a parking spot to plot), so a page with no map
 * never pays for the library.
 */
export const maplibreHead = (): Html =>
  html`<link rel="stylesheet" href="${asset('/vendor/maplibre-gl.css')}">`

/**
 * A `<script>` element's own text is never HTML-entity-decoded — the HTML
 * parser only ever watches for a literal `</script`, case-insensitively — so
 * running this JSON through `html`'s usual `escape()` would corrupt it
 * (`&lt;` would reach `JSON.parse` as four characters, not one) without even
 * closing the real gap: a route named `</script>` would still end the
 * element early, before `JSON.parse` ever ran. Escaping `<` to `\u003c` — a
 * valid JSON string escape — fixes both at once. `raw()` is `html.ts`'s own
 * documented, visible-at-the-call-site hatch for exactly this: a value this
 * module has itself made safe, by a different rule than the one `html`
 * enforces everywhere else.
 */
function pinData(pins: readonly Pin[]): Html {
  return raw(JSON.stringify(pinFields(pins)).replace(/</g, '\\u003c'))
}

function pinFields(pins: readonly Pin[]) {
  return pins.map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, activity: p.activity, recap: p.recap }))
}

/** The neighbours a page's own map pins around its subject; left out of the payload when there are none. */
function aroundField(around: readonly Pin[]) {
  const located = around.filter(p => p.lat !== null && p.lon !== null)
  return located.length ? { around: pinFields(located) } : {}
}

/**
 * The home map: a real slippy map, same as `findMap` below — home plots a
 * flat, ungraded sample of the archive, where Find fits to whatever the
 * current search returned; both colour each point by its activity. Pins
 * cross to the client as embedded JSON rather than a second request;
 * `public/home-map.js` reads `#map-data` and does the rest. See
 * the home map's design spec.
 */
export function homeMap(pins: readonly Pin[]): Html {
  return html`<div class="map" id="map">
    <noscript>La mappa richiede JavaScript. Gli itinerari restano raggiungibili cercandoli qui sopra.</noscript>
  </div>
  <script type="application/json" id="map-data">${pinData(pins)}</script>
  <script type="module" src="${asset('/home-map.js')}"></script>`
}

/**
 * Find's map: fits to whatever the current search actually returned, each
 * point in its activity's colour; its conditions are said on its card, which
 * home's ungraded pins leave out. See
 * the design spec for a map on every page.
 */
export function findMap(pins: readonly Pin[]): Html {
  return html`<div class="map" id="map">
    <noscript>La mappa richiede JavaScript. Gli itinerari restano raggiungibili cercandoli qui sopra.</noscript>
  </div>
  <script type="application/json" id="map-data">${pinData(pins)}</script>
  <script type="module" src="${asset('/find-map.js')}"></script>`
}

/**
 * One marker at the parking spot, and — where the itinerary has its own
 * coordinates too — a second, distinct marker for the itinerary itself.
 * Neither is a `Pin`: a parking spot has no id, and the itinerary marker is
 * this page's own subject, so clicking either goes nowhere, unlike every
 * other thing this module puts on a map. `itineraryLat`/`itineraryLon`
 * default to `null` and are left out of the payload entirely when either is
 * missing, so the client draws exactly one marker, as it always has.
 * `label` is the itinerary's own name, carried through the same
 * `<`-to-`\u003c` JSON embedding as a route name, because it reaches the
 * page the same way; it also appears in the container's own `aria-label`,
 * through `html`'s ordinary escaping, since that is a plain HTML attribute
 * and not `<script>` content — the two escapes exist for different reasons
 * and neither substitutes for the other.
 *
 * `around` is every other route of the same activity nearby, drawn as pins
 * that do click through, each to its own route — left out of the payload
 * when there are none.
 */
export function parkingMap(
  lat: number, lon: number, label: string,
  itineraryLat: number | null = null, itineraryLon: number | null = null,
  around: readonly Pin[] = [],
): Html {
  const hasItinerary = itineraryLat !== null && itineraryLon !== null
  const json = JSON.stringify({
    lat, lon, label,
    ...(hasItinerary ? { itineraryLat, itineraryLon } : {}),
    ...aroundField(around),
  })
  const data = raw(json.replace(/</g, '\\u003c'))
  const ariaLabel = hasItinerary
    ? `Mappa della zona di parcheggio e della posizione di ${label}`
    : `Mappa della zona di parcheggio per ${label}`

  return html`<div class="pk__map" id="map" role="group" aria-label="${ariaLabel}">
    <noscript>La mappa richiede JavaScript. Le coordinate del parcheggio sono qui sopra.</noscript>
  </div>
  <script type="application/json" id="map-data">${data}</script>
  <script type="module" src="${asset('/parking-map.js')}"></script>`
}

/**
 * The crag's map: its parking and its wall as two shapes, framed to hold both,
 * joined by the walk between them, labelled with the approach time. Where a
 * hiking router found that walk on mapped paths (`trail`), the line follows
 * it, and the walk's figures sit under the map — length, climb, time — with a
 * line saying where the path came from: the best path on the map, not a
 * guidebook's. Otherwise the line is straight and dashed, showing how far
 * apart the two are, not the way to walk.
 *
 * The time is the crag page's own (`approach`) wherever it has one; only
 * where it has none, and there is a trail, is it worked out from the trail
 * (`walkMinutes`), shown with a tilde and said to be an estimate.
 *
 * A click opens the map large; `big` carries that view's caption, already in
 * words, so the client only places text.
 * Either point may be missing; with neither there is nothing to draw, and the
 * caller gets null. `around` is the other crags nearby, drawn as clickable
 * pins in the activity's colour, each opening the same card as on Find. See its design spec §2
 * and its design spec.
 */
export function pointsMap(
  parking: { lat: number; lon: number } | null,
  crag: { lat: number; lon: number } | null,
  name: string,
  approach: string | null,
  trail: Trail | null = null,
  around: readonly Pin[] = [],
  words: WalkMapWords = CRAG_WALK,
): Html | null {
  if (!parking && !crag) return null
  const path = trail && trail.coords.length >= 2 ? trail : null
  const estimated = words.estimate && approach === null && path !== null
  const time = approach ?? (estimated && path ? `~${duration(walkMinutes(path))}` : null)
  const figures = path ? walkFigures(path, time) : []

  const data = raw(JSON.stringify({
    parking, crag, approach: time,
    ...(path ? { trail: { coords: path.coords, labelAt: halfwayAlong(path.coords) } } : {}),
    big: { title: `${name} · ${words.bigTitle}`, summary: figures.map(f => f.text).join(' · ') || time || '' },
    // Said only where they differ from a crag's, which the client takes as given.
    ...(words.goal !== 'f' ? { goal: words.goal } : {}), ...(words.ends ? {} : { ends: false }),
    ...aroundField(around),
  }).replace(/</g, '\\u003c'))

  const note = path
    ? html`
  <div class="pk__walkin">
    <dl class="pk__fig">${join(figures.map(f => html`<div><dt>${f.label}</dt><dd>${f.text}</dd></div>`), '')}</dl>
    <p class="pk__src"><i aria-hidden="true"></i>${words.source}${estimated ? ' · tempo stimato' : ''} · da verificare sul posto</p>
  </div>`
    : html``

  return html`<div class="pk__map" id="map" role="group" aria-label="${words.aria} ${name}">
    <noscript>La mappa richiede JavaScript. Le coordinate sono qui sopra.</noscript>
  </div>${note}
  <script type="application/json" id="map-data">${data}</script>
  <script type="module" src="${asset('/crag-map.js')}"></script>`
}

/**
 * What a walk's map says about the walk, which differs between a crag's
 * approach — a router's guess between two points — and a hike's track, which
 * somebody walked. `goal` is the row whose shape marks the far end (see
 * shapeFromRow); `ends` dots the gaps between the path and the two points,
 * which a track has none of; `estimate` works out a time where none is given,
 * which on a track would be a guess at a whole day, out and back or not.
 */
export interface WalkMapWords {
  readonly aria: string
  readonly bigTitle: string
  readonly source: string
  readonly goal: 'f' | 'v'
  readonly ends: boolean
  readonly estimate: boolean
}

export const CRAG_WALK: WalkMapWords = {
  aria: 'Mappa del parcheggio e della falesia', bigTitle: 'avvicinamento',
  source: 'Sentiero suggerito da OpenStreetMap', goal: 'f', ends: true, estimate: true,
}

export const HIKE_TRACK: WalkMapWords = {
  aria: 'Mappa della traccia di', bigTitle: 'traccia',
  source: 'Traccia GPS di chi l’ha percorsa', goal: 'v', ends: false, estimate: false,
}

/** Length always; the climb where the router gave one; the time where there is one. */
function walkFigures(t: Trail, time: string | null): { label: string; text: string }[] {
  const figures = [{ label: 'Lunghezza', text: `${(t.lengthM / 1000).toFixed(1).replace('.', ',')} km` }]
  if (t.ascentM !== null) figures.push({ label: 'Dislivello', text: `+${Math.round(t.ascentM)} m` })
  if (time !== null) figures.push({ label: 'Tempo', text: time })
  return figures
}

/** "45 min", "1 h", "1 h 15". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}
