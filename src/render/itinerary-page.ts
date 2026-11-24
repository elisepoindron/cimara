import { asset } from './assets.ts'
import type { ActivitySchema, SectionDef } from '../domain/registry.ts'
import { weatherAltitudeM, type Weather } from '../domain/weather.ts'
import type { NearbyStation } from '../domain/stations.ts'
import type { Trail } from '../domain/trail.ts'
import type { TrackPoint } from '../domain/track.ts'
import type { ItineraryRow } from '../db/itinerary.ts'
import type { PlaceRow } from '../db/place.ts'
import type { Part, FactValue } from '../domain/facts.ts'
import type { NearbyRoute } from '../db/itinerary.ts'
import type { PhotoRow } from '../db/gita-photo.ts'
import type { SynthesisRow } from '../db/synthesis.ts'
import type { PageCredits } from '../db/credits.ts'
import { breadcrumb } from './breadcrumb.ts'
import { factsStrip } from './facts-strip.ts'
import { gradeHistogram } from './histogram.ts'
import { partsList } from './parts-list.ts'
import { pitchList } from './pitch-list.ts'
import { proseSection } from './prose.ts'
import { roadPanel, roadRows } from './access-section.ts'
import { giudiziLine } from './giudizi.ts'
import { alpinePoints, cragPoints, trackPoints } from './crag-points.ts'
import { accessPoints } from '../domain/geo.ts'
import { conditionsSlot } from './conditions-slot.ts'
import { aroundPins, nearbySection } from './nearby-section.ts'
import { photosSlot } from './photos-slot.ts'
import { shell, type Viewer } from './shell.ts'
import { maplibreHead } from './live-map.ts'
import { favoriteButton } from './favorite-button.ts'
import { reportCta } from './report-cta.ts'
import { reportsBox } from './synthesis-box.ts'
import { pageFoot } from './page-foot.ts'
import { html, join, type Html } from './html.ts'

export interface PageInput {
  readonly itinerary: ItineraryRow
  readonly schema: ActivitySchema
  readonly places: readonly PlaceRow[]
  /** The Find line for each place the breadcrumb can link; see `crumbLines`. */
  readonly crumbLines?: ReadonlyMap<string, string>
  readonly parts: readonly Part[]
  readonly facts: readonly FactValue[]
  /**
   * Facts for the Come arrivare panel specifically — resolved separately from
   * `facts` so they never leak into the header strip. Absent for a caller
   * that has not resolved them (every current test fixture but the two that
   * specifically exercise this section), the same convention `photos`,
   * `reportCount`, and `synthesis` already use on this interface.
   */
  readonly access?: readonly FactValue[]
  /** Routes nearby with the same aspect, nearest first, for their own section.
   * Absent or empty, the section is left out. */
  readonly nearby?: readonly NearbyRoute[]
  /** Every route of the same activity around this one, nearest first, drawn
   * as pins on the page's map. Absent or empty, the map shows only this one. */
  readonly around?: readonly NearbyRoute[]
  readonly photos?: readonly PhotoRow[]
  /** When the description was last revised and who wrote it, for the colophon. */
  readonly credits?: PageCredits
  /**
   * How many gite stand behind this route, retractions already excluded —
   * `giteFor(db, id).length`. Absent or zero, the relazioni section has
   * nothing to point at and renders nothing.
   */
  readonly reportCount?: number
  /** The cached, grounded theme synthesis for this route, when one exists —
   * `null`/absent renders nothing extra. */
  readonly synthesis?: SynthesisRow | null
  /** The most recently observed report's date, for the synthesis caption's
   * "l'ultima di N giorni fa" — absent when there is no synthesis to caption. */
  readonly lastReportAt?: string
  /** When each standing report was observed, by id, so the reports box can
   * date and count the changes the synthesis found. Absent, it shows none. */
  readonly reportDates?: ReadonlyMap<string, string>
  /**
   * Who is reading, when the caller knows. The nav greets them and offers the
   * way out; task 12's withdraw control asks whether they wrote the report on
   * screen. Absent is a signed-out reader, not an error.
   */
  readonly viewer?: Viewer | null
  /** This request's CSRF token, for the forms on the page — the way out included. */
  readonly csrf?: string
  /** Whether the signed-in reader has starred this itinerary. Absent (treated as
   * false) for a caller that has not looked — a signed-out reader, or a page
   * test that does not exercise the star. */
  readonly isFavorite?: boolean
  /**
   * The clock the conditions module dates its report against — "due giorni fa".
   * Passed rather than left to default so a page test can pin the whole cite,
   * and so one render does not call `new Date()` twice.
   */
  readonly now?: Date
  /** The cached weather for this route's coordinates, when one exists —
   * resolved server-side by weatherFor, the same read the condition engine
   * uses. Drawn inside Condizioni; absent or null, there is no strip. */
  readonly weather?: Weather | null
  /** Weather stations near the route, nearest first, for the fold under `Adesso`. */
  readonly stations?: readonly NearbyStation[]
  /** The walk from the parking to the crag, as trailFor cached it. Absent or
   * null, the map joins the two points with a straight dashed line. */
  readonly trail?: Trail | null
  /** The route's own recorded track, where somebody gave it one. */
  readonly track?: readonly TrackPoint[] | null
}

function sectionFor(def: SectionDef, input: PageInput): Html | null {
  if (def.kind === 'prose') {
    const { sections } = input.itinerary
    return proseSection(def, sections[def.id], sections)
  }

  if (def.kind === 'generated') {
    switch (def.render) {
      case 'gradi': {
        const chart = gradeHistogram(input.schema, input.parts, 'grado')
        return chart && html`<section id="${def.id}">
        <h2>${def.label.it}</h2>
        ${chart}
      </section>`
      }
      case 'settori': {
        const list = partsList(input.schema, input.parts)
        if (!list) return null
        if (input.parts.length <= FOLD_AFTER) return html`<section id="${def.id}">
        <h2>${def.label.it}</h2>
        ${list}
      </section>`
        return foldedSettori(def, list, input.parts.length)
      }
      // An elevation profile needs a track. Project 1 stores one point.
      case 'tiri': {
        const list = pitchList(input.schema, input.parts)
        return list && html`<section id="${def.id}">
        <h2>${def.label.it}</h2>
        ${list}
      </section>`
      }
      case 'profilo': return null
      default: return null
    }
  }

  // Furniture: dispatch on the declared render kind, not on the section id —
  // 'condizioni', 'relazioni', 'parcheggio', 'punti', 'strada' and 'foto' have
  // renderers behind them; the rest are still declared for shape only.
  if (def.kind === 'furniture') {
    switch (def.render) {
      case 'condizioni':
        return conditionsSlot({
          sectionId: def.id, now: input.now, weather: input.weather,
          lat: input.itinerary.lat, lon: input.itinerary.lon, figures: input.schema.skyFigures,
          stations: input.stations, altitudeM: weatherAltitudeM(input.itinerary.facts),
        })
      case 'vicine':
        return nearbySection(input.nearby ?? [], {
          sectionId: def.id, label: def.label.it, now: input.now ?? new Date(),
        })
      case 'relazioni': {
        const n = input.reportCount ?? 0
        if (n === 0) return null
        const box = reportsBox(input.synthesis ?? null, {
          reportCount: n, lastReportAt: input.lastReportAt, now: input.now,
          reportDates: input.reportDates, itineraryId: input.itinerary.id,
        })
        return html`<section id="${def.id}">
        <h2>${def.label.it}</h2>
        ${box}
      </section>`
      }
      case 'parcheggio':
        return alpinePoints(input.itinerary, { sectionId: def.id, label: def.label.it },
          aroundPins(input.around ?? [], input.itinerary.activity, input.now ?? new Date()),
          roadRows(input.access ?? []))
      case 'punti': {
        // The approach labels the line between the two points. Read off the
        // resolved facts by id: this renderer exists only for activities
        // that declare it, and a crag's walk-in is its avvicinamento.
        const approach = input.facts.find(f => f.def.id === 'avvicinamento')
        return cragPoints(input.itinerary, approach && approach.value !== null ? approach.text : null,
          { sectionId: def.id, label: def.label.it, ...(def.point && { point: def.point }) }, input.trail ?? null,
          aroundPins(input.around ?? [], input.itinerary.activity, input.now ?? new Date()),
          roadRows(input.access ?? []))
      }
      case 'foto':
        return photosSlot(input.photos ?? [], {
          sectionId: def.id, itineraryId: input.itinerary.id,
          itineraryName: input.itinerary.name, now: input.now,
        })
      case 'strada':
        return roadPanel({ sectionId: def.id, label: def.label.it }, roadRows(input.access ?? []))
      case 'traccia': {
        const around = aroundPins(input.around ?? [], input.itinerary.activity, input.now ?? new Date())
        const { parking } = accessPoints(input.itinerary)
        if (input.track) {
          return trackPoints(input.track, input.itinerary.name, { sectionId: def.id, label: def.label.it },
            around, roadRows(input.access ?? []), parking)
        }
        // No track: the parking and the top, as an alpine route's, where a
        // parking is recorded; the road in words alone where it is not.
        return alpinePoints(input.itinerary, { sectionId: def.id, label: def.label.it }, around,
          roadRows(input.access ?? []))
      }
      default:
        return null
    }
  }

  return null
}

/**
 * A crag with more vie than this starts with its list folded: the first rows
 * show and fade into the paper, and one link opens the rest. Below it the
 * fold would hide only a handful of rows, which costs a click for nothing.
 */
export const FOLD_AFTER = 12

/**
 * The long list, folded. The whole list is in the markup, so without
 * JavaScript it simply reads in full and the link never shows. The inline
 * line marks the section folded while the page is still being parsed, so the
 * full list is never painted and then snatched away; vie-fold.js wires the
 * link and the motion.
 */
function foldedSettori(def: SectionDef, list: Html, count: number): Html {
  const bodyId = `${def.id}-vie`
  const more = `Mostra tutte le ${count} vie`
  return html`<section id="${def.id}" class="vie-fold">
        <h2>${def.label.it}</h2>
        <script>document.currentScript.parentElement.classList.add('is-folded')</script>
        <div class="vie-fold__body" id="${bodyId}">
        ${list}
        </div>
        <button type="button" class="vie-fold__toggle" aria-controls="${bodyId}" aria-expanded="false"
          data-more="${more}" data-less="Mostra meno">${more}</button>
        <script src="${asset('/vie-fold.js')}" defer></script>
      </section>`
}

/** A maximal run of consecutive, rendered sections that share one defined `group`. */
interface Run {
  readonly group: string | undefined
  readonly items: Html[]
}

/**
 * Consecutive rendered sections sharing the same defined `group` become one run;
 * an ungrouped section, or a group boundary, starts a new one. A section with no
 * `group` never merges with its neighbours, even when they too have no `group` —
 * each renders in its own, unwrapped place.
 */
function runsOf(rendered: readonly { group: string | undefined; html: Html }[]): Run[] {
  const runs: Run[] = []
  for (const { group, html: item } of rendered) {
    const last = runs[runs.length - 1]
    if (group !== undefined && last?.group === group) {
      last.items.push(item)
    } else {
      runs.push({ group, items: [item] })
    }
  }
  return runs
}

/**
 * The rendered sections of one column (document or rail), grouped sections
 * wrapped in `<div class="{group}">` where they run contiguously — `.tail` in
 * both route.html and crag.html, holding only the short prose sections between
 * "Cosa dicono le relazioni" and "Storico e fonti". Never `+` on `Html`.
 */
interface Rendered { readonly id: string; readonly group: string | undefined; readonly html: Html }

/** The sections of one column that have something to show, in the registry's order. */
function renderedOf(defs: readonly SectionDef[], input: PageInput): Rendered[] {
  return defs
    .map(d => ({ id: d.id, group: d.group, html: sectionFor(d, input) }))
    .filter((r): r is Rendered => r.html !== null)
}

function present(rendered: readonly Rendered[]): Html {
  const blocks = runsOf(rendered).map(run =>
    run.group !== undefined
      ? html`<div class="${run.group}">${join(run.items, '\n        ')}</div>`
      : join(run.items, '\n      '))

  return join(blocks, '\n      ')
}

/**
 * Which of the phone's five panels a section belongs to, by its id
 * (mobile-options.html, E1: each tab one subject). The second panel is the
 * route itself: a crag's routes, or an itinerary's description and pitches.
 * A section not listed here — the nearby routes, the webcams — is not shown on
 * a phone. The desktop reads none of this: its two columns stay as they are.
 */
const TAB_OF: Readonly<Record<string, PhoneTab>> = {
  dati: 'generale', condizioni: 'generale', storico: 'generale',
  gradi: 'vie', settori: 'vie', profilo: 'vie', tiri: 'vie', descrizione: 'vie', discesa: 'vie', materiale: 'vie',
  relazioni: 'relazioni',
  foto: 'foto',
  parcheggio: 'accesso', accesso: 'accesso', avvicinamento: 'accesso', appoggio: 'accesso',
}
type PhoneTab = 'generale' | 'vie' | 'relazioni' | 'foto' | 'accesso'

/**
 * The phone's tabs (K1, S8): each a button that shows its panel and hides the
 * others, in place; page-phone.js does it, from the map carried on the strip.
 * Without that script the strip is never shown and the page reads as one long
 * column. Above 760px it is not shown at all. A tab with nothing in it is left
 * out; fewer than three is not worth a strip.
 */
function sectionTabs(input: PageInput, ids: ReadonlySet<string>): Html {
  const has = (t: PhoneTab) => t === 'generale' || [...ids].some(id => TAB_OF[id] === t)
  const isCrag = ids.has('settori') || ids.has('gradi')
  const tabs: [PhoneTab, string, number | undefined][] = [
    ['generale', 'Generale', undefined],
    ['vie', isCrag ? 'Vie' : 'Itinerario', undefined],
    ['relazioni', 'Relazioni', input.reportCount],
    ['foto', 'Foto', input.photos?.length],
    ['accesso', 'Accesso', undefined],
  ]
  const shown = tabs.filter(([t]) => has(t))
  if (shown.length < 3) return html``
  const map = JSON.stringify(Object.fromEntries([...ids, 'dati'].filter(id => TAB_OF[id]).map(id => [id, TAB_OF[id]])))
  return html`<div class="ptabs" role="tablist" aria-label="Sezioni della scheda" data-map="${map}">${join(shown.map(([t, label, n], i) =>
    html`<button type="button" role="tab" data-tab="${t}" aria-selected="${i === 0 ? 'true' : 'false'}">${label}${n ? html` <small>${n}</small>` : html``}</button>`), '')}<i class="ptabs__ul" aria-hidden="true"></i></div>`
}

/**
 * On a phone, the facts open the Generale panel as one card: two columns of
 * label and value, only what is recorded, the ratings as stars after them
 * (mobile-options.html, D3 and G2). Above 760px it is not drawn — the strip
 * and the Giudizi line under the title say the same.
 */
function phoneFacts(values: readonly FactValue[]): Html {
  const recorded = values.filter(v => v.value !== null)
  if (recorded.length === 0) return html``
  const cell = (v: FactValue) => {
    const stars = v.def.quantity.kind === 'stars' && typeof v.value === 'number'
      ? html`<span class="pdati__st" role="img" aria-label="${v.text}"><span>${'★'.repeat(v.value)}</span>${'★'.repeat(5 - v.value)}</span>`
      : null
    const warn = v.def.warnIf !== undefined && v.value === v.def.warnIf
    return html`<div${warn ? html` class="warn"` : html``}><dt>${v.def.label.it}</dt><dd>${stars ?? v.text}</dd></div>`
  }
  const strip = recorded.filter(v => (v.def.placement ?? 'strip') === 'strip')
  const rated = recorded.filter(v => v.def.placement === 'giudizi')
  return html`<section id="dati" class="pdati" aria-label="Dati">
        <dl>${join(strip.map(cell), '')}</dl>${rated.length ? html`<dl class="pdati__gz">${join(rated.map(cell), '')}</dl>` : html``}
      </section>`
}

/**
 * On a phone, the first of the three actions under the facts: the phone's own
 * maps, taking the climber to the parking, or to the route itself when no
 * parking is recorded. Absent with neither; never shown above 760px, where the
 * parking section already offers it.
 */
function directionsAction(it: ItineraryRow): Html {
  const lat = it.parkingLat ?? it.lat, lon = it.parkingLon ?? it.lon
  if (lat === null || lon === null) return html``
  return html`<a class="pgo" href="https://www.google.com/maps/dir/?api=1&amp;destination=${String(lat)},${String(lon)}" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 18-7-4-7 4z"/></svg>Indicazioni</a>`
}

export function itineraryPage(input: PageInput): string {
  // The title is the name alone, as Find shows it: the sectors are listed in
  // their own section, and a crag with five of them made a title nobody reads.
  const title = input.itinerary.name
  // Unlike home and find, which always draw a map, most itineraries have no
  // point to plot — so this page only pays for MapLibre's stylesheet when a
  // rail section will actually draw one: an alpine parking spot, either of
  // a crag's two points, or a hike's track.
  const it = input.itinerary
  const hasParking = it.parkingLat !== null && it.parkingLon !== null
  const hasOwnPoint = it.lat !== null && it.lon !== null
  const drawsMap = input.schema.rail.some(s => s.render === 'punti')
    ? hasParking || hasOwnPoint
    : hasParking || (input.schema.rail.some(s => s.render === 'traccia') && !!input.track)

  const doc = renderedOf(input.schema.document, input)
  const rail = renderedOf(input.schema.rail, input)
  const ids = new Set([...doc, ...rail].map(r => r.id))

  return shell({
    title,
    tab: 'trova',
    pageName: title,
    viewer: input.viewer,
    csrf: input.csrf,
    extraHead: drawsMap ? maplibreHead() : undefined,
    body: html`<div class="wrap">
  <div class="phead">
    ${breadcrumb(input.schema, input.places, input.crumbLines)}
    <div class="ptitle">
      <h1>${title}</h1>
      ${favoriteButton({
        itineraryId: input.itinerary.id, isFavorite: input.isFavorite ?? false,
        next: `/itinerario/${input.itinerary.id}`,
        viewer: input.viewer, csrf: input.csrf,
      })}
      ${reportCta(input.itinerary.id)}
    </div>
    ${factsStrip(input.facts)}
    ${giudiziLine(input.facts)}
    ${directionsAction(it)}
  </div>
  ${sectionTabs(input, ids)}

  <div class="body">
    <div class="l3">
      ${phoneFacts(input.facts)}
      <main class="doc">
        ${present(doc)}
      </main>
      <aside class="railwrap"><div class="rail doc">
        ${present(rail)}
      </div></aside>
    </div>
    ${pageFoot(title, input.credits)}
  </div>
</div>`,
  })
}
