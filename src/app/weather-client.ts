import type { FetchWeather } from './weather.ts'
import { skyFromWmo, STRIP_DAYS, type Weather, type WeatherDay } from '../domain/weather.ts'

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

const PAST_DAYS = 7
const FORECAST_DAYS = 3   // today and the two days the strip forecasts
/** Today's index in the daily arrays: after the seven past days. */
const TODAY = PAST_DAYS

export interface OpenMeteoResponse {
  readonly current: {
    readonly temperature_2m: number
    /** Metres; absent from responses that were not asked for it. */
    readonly freezing_level_height?: number | null
    /** Local to the spot with timezone=auto, "2026-09-15T14:00" — what dates "today". */
    readonly time?: string
  }
  readonly daily: {
    readonly time: readonly string[]
    /** null where Open-Meteo has no data for a day — a gap, not a clear sky. */
    readonly weather_code?: readonly (number | null)[]
    /** null where Open-Meteo has no data for a day — a gap, not a dry day. */
    readonly precipitation_sum: readonly (number | null)[]
    /** Centimetres of fresh snow per day; absent where not asked for. */
    readonly snowfall_sum?: readonly (number | null)[]
    /** The day's strongest wind and gust at 10 m, km/h, and where it mostly came from, degrees. */
    readonly wind_speed_10m_max?: readonly (number | null)[]
    readonly wind_gusts_10m_max?: readonly (number | null)[]
    readonly wind_direction_10m_dominant?: readonly (number | null)[]
  }
}

/**
 * Today's index is last in the array; walking backwards from it finds the
 * most recent day with rain. null: no rain anywhere in the array.
 *
 * The caller must hand it the past days and today only. The response also
 * carries forecast days, and a forecast day read here is forecast rain read
 * as rain that already fell — the bug this comment has warned about since
 * the query first asked for no forecast at all.
 *
 * A missing day is skipped rather than read — it is evidence of neither rain
 * nor dryness — and the count stays measured from today.
 */
export function daysSinceRainFrom(sums: readonly (number | null)[]): number | null {
  for (let i = sums.length - 1; i >= 0; i--) {
    const sum = sums[i]
    if (sum != null && sum > 0) return sums.length - 1 - i
  }
  return null
}

/**
 * One response, turned into what the rules read and what the strip draws.
 *
 * Today is found by its date, from the current reading, so a response with
 * fewer past days than asked still never counts a forecast day as past; a
 * response whose days do not include today is refused, and the cache keeps
 * its previous row. The strip's days are positional — seven past, today, two
 * forecast — so any other layout, or a response without sky codes, gives no
 * days rather than days labelled wrongly, and the signal still reads.
 */
export function weatherFrom(data: OpenMeteoResponse): Weather {
  const { time, weather_code: codes, precipitation_sum: sums, snowfall_sum: snow,
    wind_speed_10m_max: wind, wind_gusts_10m_max: gust, wind_direction_10m_dominant: from } = data.daily
  const today = data.current.time === undefined
    ? (time.length === STRIP_DAYS ? TODAY : -1)
    : time.indexOf(data.current.time.slice(0, 10))
  if (today < 0) throw new Error('open-meteo: the daily figures do not include today')

  const whole = today === TODAY && Array.isArray(codes)
    && time.length === STRIP_DAYS && codes.length === STRIP_DAYS && sums.length === STRIP_DAYS

  const days: WeatherDay[] | null = whole
    ? time.map((date, i): WeatherDay => ({
        date,
        when: i < TODAY ? 'past' : i === TODAY ? 'today' : 'forecast',
        sky: skyFromWmo(codes[i]),
        rainMm: sums[i] ?? null,
        ...(Array.isArray(snow) ? { snowCm: snow[i] ?? null } : {}),
        ...(Array.isArray(wind) && Array.isArray(gust) && Array.isArray(from)
          ? { windKmh: wind[i] ?? null, gustKmh: gust[i] ?? null, windFromDeg: from[i] ?? null } : {}),
      }))
    : null

  return {
    // Whole degrees, as both mockups set it.
    tempC: Math.round(data.current.temperature_2m),
    daysSinceRain: daysSinceRainFrom(sums.slice(0, today + 1)),
    days,
    freezingLevelM: data.current.freezing_level_height ?? null,
  }
}

/**
 * The one request. `elevation` is the height Open-Meteo corrects its figures
 * to; left out, it takes the ground's under the coordinates from a 90 m
 * elevation model, which is right only where the pin is the climb.
 */
export function weatherUrl(lat: number, lon: number, altitudeM: number | null): string {
  return `${ENDPOINT}?latitude=${lat}&longitude=${lon}`
    + (altitudeM === null ? '' : `&elevation=${altitudeM}`)
    + `&current=temperature_2m,precipitation,weather_code,freezing_level_height`
    + `&daily=precipitation_sum,weather_code,snowfall_sum`
    + `,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant`
    + `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=auto`
}

/** Wired once at server startup. Never constructed in a test — see
 * FetchWeather's seam in weather.ts. */
export const realFetchWeather: FetchWeather = async (lat, lon, altitudeM) => {
  const response = await fetch(weatherUrl(lat, lon, altitudeM))
  if (!response.ok) throw new Error(`open-meteo: ${response.status}`)

  return weatherFrom(await response.json() as OpenMeteoResponse)
}
