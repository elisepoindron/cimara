import { compassIt, SKIES, SKY_LABELS, weekdayShort, type Sky, type Weather, type WeatherDay } from '../domain/weather.ts'
import { html, join, raw, type Html } from './html.ts'

/**
 * The six sky icons, as the design draws them. Copied from the sprite in
 * the crag mockup's strip; a private acceptance test holds the
 * two equal. Constant markup, which is the only reason raw is used for it.
 */
const SKY_SYMBOLS: Record<Sky, string> = {
  sereno: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  poco_nuvoloso: '<path d="M8.5 5.2V3.8M3.8 9.5H2.4M5.2 6.2l-1-1M12.9 6.2l1-1"/><path d="M5.6 11.6a3.6 3.6 0 0 1 6.6-2.4"/><path d="M8.5 20h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8.5 20z"/>',
  nuvoloso: '<path d="M7 19h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 19z"/>',
  pioggia: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  neve: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><circle cx="7.5" cy="18.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="18.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.75" cy="21.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.25" cy="21.8" r="1.1" fill="currentColor" stroke="none"/>',
  temporale: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
}

/** The sprite the strip draws its icons from — one strip per page, so one sprite. */
export function weatherSprite(): Html {
  const symbols = SKIES.map(s => `<symbol id="w-${s}" viewBox="0 0 24 24">${SKY_SYMBOLS[s]}</symbol>`)
  return raw(`<svg class="icons" aria-hidden="true"><defs>\n              ${symbols.join('\n              ')}\n            </defs></svg>`)
}

/** Full bar height, in millimetres. Fixed, so bars compare across pages and weeks. */
const FULL_MM = 20
/** The least a rainy day's bar is drawn at, so a drizzle is still seen. */
const MIN_PCT = 8

/**
 * The weather strip that sits inside the conditions card: seven past days,
 * today, two forecast. Null when there are no days to draw, and the card
 * then renders as it did before the strip existed.
 *
 * No sentence under it. "Non piove da 4 giorni" repeated what the bars already
 * show, a line below them. The credit stays, alone and small: Open-Meteo's
 * data is CC BY 4.0, and attribution is the condition of using it.
 */
export function weatherStrip(weather: Weather): Html | null {
  if (weather.days === null) return null

  return html`<div class="wxs">
            ${weatherSprite()}
            <div class="wxs__h"><span class="lab">${weather.days.some(d => d.windKmh != null) ? 'Pioggia, cielo e vento' : 'Pioggia e cielo'}</span><span class="wxs__now">${weather.tempC}<small>°C ora</small></span></div>
            <ol class="wxs__days">
              ${join(weather.days.map(column), '\n              ')}
            </ol>
            <p class="wxs__f wxs__f--credit"><span>Open-Meteo.com</span></p>
          </div>`
}

function column(day: WeatherDay): Html {
  const cls = day.when === 'today' ? html` class="wxs__today"` : day.when === 'forecast' ? html` class="wxs__fc"` : null
  const name = day.when === 'today' ? 'Oggi' : weekdayShort(day.date)
  return html`<li${cls}>${sky(day.sky)}<span class="wxs__mm">${figure(day.rainMm)}</span><span class="wxs__well">${bar(day.rainMm)}</span><span class="wxs__d">${name}</span>${wind(day)}</li>`
}

/** The icon, naming itself; an empty placeholder of the same size where there is no sky to name. */
function sky(s: Sky | null): Html {
  if (s === null) return html`<span class="ic"></span>`
  const label = SKY_LABELS[s]
  return html`<svg class="ic" role="img" aria-label="${label}"><title>${label}</title><use href="#w-${s}"/></svg>`
}

/** Whole millimetres; "<1" for rain too slight to round up to one. */
function figure(mm: number | null): string {
  if (mm === null || mm <= 0) return ''
  const whole = Math.round(mm)
  return whole === 0 ? '<1' : String(whole)
}

function bar(mm: number | null): Html | null {
  if (mm === null) return html`<b title="Dato mancante">–</b>`
  if (mm <= 0) return null
  const pct = Math.max(MIN_PCT, Math.round(Math.min(mm / FULL_MM, 1) * 100))
  return html`<i style="height:${pct}%"></i>`
}

/**
 * Under the day's name, an arrow pointing where the wind blows and the day's
 * strongest wind in km/h; the gust and the compass point in the tooltip. The
 * wind is the model's for its grid, not corrected for the route's height as
 * the temperature is. Nothing where the day has no wind figure — a day cached
 * before wind was fetched, or one Open-Meteo has none for.
 */
function wind(day: WeatherDay): Html | null {
  const kmh = day.windKmh, deg = day.windFromDeg
  if (kmh == null || deg == null) return null
  const speed = Math.round(kmh)
  const gust = day.gustKmh == null ? '' : `, raffiche ${Math.round(day.gustKmh)} km/h`
  // Where it comes from, turned half a circle: the arrow points downwind.
  const turn = Math.round(deg + 180) % 360
  return html`<span class="wxs__w" title="Vento da ${compassIt(deg)}, fino a ${speed} km/h${gust}"><svg class="wxs__wa" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${turn}deg)"><path d="M12 3v18M12 3l-5 6M12 3l5 6"/></svg>${speed}</span>`
}
