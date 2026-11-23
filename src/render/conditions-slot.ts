import { asset } from './assets.ts'
import { heightAgainst, stationPage, STATION_NETWORKS, type NearbyStation } from '../domain/stations.ts'
import { freshSnow, lastRain, sunset } from '../domain/sky.ts'
import type { SkyFigure } from '../domain/registry.ts'
import type { Weather, WeatherDay } from '../domain/weather.ts'
import { html, join, type Html } from './html.ts'
import { weatherStrip } from './weather-strip.ts'

/**
 * The conditions column: the sky, and nothing a report said. The weather
 * strip, then the figure cards under it — when it last rained and when the
 * sun sets. It is the same whether someone went yesterday or nobody ever has:
 * how recent the reports are is said once, in the footer of
 * `Cosa dicono le relazioni`, and what they found is in their words.
 *
 * See its design spec.
 */
export interface SlotOpts {
  readonly sectionId?: string
  /** The clock the sunset is computed for when there is no strip to date today. */
  readonly now?: Date
  /** The spot's cached weather; null or absent before the first fetch. */
  readonly weather?: Weather | null
  /** The route's coordinates. Without them there is no sky to say anything about. */
  readonly lat: number | null
  readonly lon: number | null
  /** The activity's extra figures, from the registry. Absent: none. */
  readonly figures?: readonly SkyFigure[]
  /** Weather stations near the route, nearest first; absent or empty, no fold. */
  readonly stations?: readonly NearbyStation[]
  /** The route's own height, what each station's is said against. */
  readonly altitudeM?: number | null
}

/**
 * Null for a route with no coordinates: no weather can be fetched for it and no
 * sunset computed, so the column would be a heading over nothing.
 */
export function conditionsSlot(opts: SlotOpts): Html | null {
  if (opts.lat === null || opts.lon === null) return null
  const now = opts.now ?? new Date()

  const days = opts.weather?.days ?? null
  const strip = opts.weather ? weatherStrip(opts.weather) : null
  // Today as the spot counts it, where the strip knows; the server's UTC day otherwise.
  const today = days?.find(d => d.when === 'today')?.date ?? now.toISOString().slice(0, 10)

  const cards = [
    days === null ? null : rainCard(days),
    sunsetCard(sunset(opts.lat, opts.lon, today)),
    ...(opts.figures ?? []).map(f => f === 'zero_termico'
      ? freezingCard(opts.weather?.freezingLevelM ?? null)
      : days === null ? null : snowCard(freshSnow(days))),
  ].filter((c): c is Html => c !== null)

  const grid = cards.length === 0 ? null
    : html`<dl class="cgrid">${join(cards, '\n            ')}</dl>`

  return html`<section id="${opts.sectionId ?? 'condizioni'}">
        <h2>Adesso</h2>
        <div class="cond">
          ${strip}
          ${grid}
          ${stationsFold(opts.stations ?? [], opts.altitudeM ?? null)}
        </div>
      </section>`
}

/**
 * "4 giorni fa · 12 mm", "Ieri · 3 mm". Labelled for what fell: a day the sky
 * was snow says neve, so a mountain is not told it rained. Seven days of strip
 * with none says so, rather than leaving the card out and the reader guessing.
 */
function rainCard(days: readonly WeatherDay[]): Html {
  const last = lastRain(days)
  if (last === null) {
    return html`<div><dt>Ultima pioggia</dt><dd>Nessuna<small>in 7 giorni</small></dd></div>`
  }
  const label = last.snow ? 'Ultima neve' : 'Ultima pioggia'
  const mm = last.mm < 1 ? '<1 mm' : `${Math.round(last.mm)} mm`
  const value = last.daysAgo === 0 ? html`Oggi<small>${mm}</small>`
    : last.daysAgo === 1 ? html`Ieri<small>${mm}</small>`
    : html`${last.daysAgo}<small>giorni fa · ${mm}</small>`
  return html`<div><dt>${label}</dt><dd>${value}</dd></div>`
}

/** "16:52", on Italian time whatever the server's zone. */
function sunsetCard(at: Date | null): Html | null {
  if (at === null) return null
  const clock = at.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
  return html`<div><dt>Tramonto</dt><dd>${clock}</dd></div>`
}

/** "3600 m", to the nearest fifty: the model's own grain is coarser than a metre. */
function freezingCard(m: number | null): Html | null {
  if (m === null) return null
  return html`<div><dt>Zero termico</dt><dd>${Math.round(m / 50) * 50}<small>m</small></dd></div>`
}

/** "17 cm in 7 giorni", or "Nessuna in 7 giorni"; left out where nothing is known. */
function snowCard(cm: number | null): Html | null {
  if (cm === null) return null
  const value = cm < 0.5 ? html`Nessuna<small>in 7 giorni</small>` : html`${Math.round(cm)}<small>cm in 7 giorni</small>`
  return html`<div><dt>Neve fresca</dt><dd>${value}</dd></div>`
}

/**
 * The stations nearby, closed under the figures: what fell, measured, is on
 * each station's own page, and the fold says only which station, how far and
 * how high against the route. Opened in place by station-fold.js; without it
 * the browser's own details element opens it, at once.
 */
function stationsFold(stations: readonly NearbyStation[], altitudeM: number | null): Html | null {
  const linked = stations.flatMap(s => {
    const href = stationPage(s)
    return href === null ? [] : [{ s, href }]
  })
  if (linked.length === 0) return null

  const rows = linked.map(({ s, href }) => {
    const against = heightAgainst(s.altM, altitudeM)
    return html`<a href="${href}" target="_blank" rel="noopener"><span><span class="near__n">${s.name}</span><span class="near__m">${stationDistance(s.distanceM)} · ${s.altM} m</span></span><span class="near__d">${against ?? ''}</span></a>`
  })
  const sources = [...new Set(linked.map(({ s }) => STATION_NETWORKS[s.network]!.source))].join(', ')

  return html`<details class="stz">
            <summary>Stazioni meteo vicine<span class="stz__n">${linked.length}</span></summary>
            <div class="stz__body">
              <div class="near">
                ${join(rows, '\n                ')}
              </div>
              <p class="stz__src">Dati misurati: ${sources}</p>
            </div>
            <script src="${asset('/station-fold.js')}" defer></script>
          </details>`
}

/** "meno di 1 km", "3 km": the grain the nearby section uses. */
function stationDistance(m: number): string {
  return m < 1000 ? 'meno di 1 km' : `${Math.round(m / 1000)} km`
}
