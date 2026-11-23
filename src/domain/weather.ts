import type { StoredFacts } from './facts.ts'

/**
 * What the sky did on one day, in the six words the strip draws. Open-Meteo's
 * WMO codes are finer than a thirty-pixel column can show, so fog folds into
 * nuvoloso and every kind of drizzle and rain into pioggia.
 */
export type Sky = 'sereno' | 'poco_nuvoloso' | 'nuvoloso' | 'pioggia' | 'neve' | 'temporale'

export const SKIES: readonly Sky[] = ['sereno', 'poco_nuvoloso', 'nuvoloso', 'pioggia', 'neve', 'temporale']

export const SKY_LABELS: Record<Sky, string> = {
  sereno: 'Sereno',
  poco_nuvoloso: 'Poco nuvoloso',
  nuvoloso: 'Nuvoloso',
  pioggia: 'Pioggia',
  neve: 'Neve',
  temporale: 'Temporale',
}

export type DayWhen = 'past' | 'today' | 'forecast'
const WHENS: readonly DayWhen[] = ['past', 'today', 'forecast']

export interface WeatherDay {
  /** YYYY-MM-DD, local to the spot. */
  readonly date: string
  readonly when: DayWhen
  /** null: Open-Meteo gave no code, or one outside the mapping. */
  readonly sky: Sky | null
  /** null: Open-Meteo has no figure for the day — a gap, not a dry day. */
  readonly rainMm: number | null
  /** Fresh snow that day, in centimetres. Absent on days cached before it was
   * fetched; null where Open-Meteo has no figure. Either way, unknown. */
  readonly snowCm?: number | null
  /** The day's strongest wind at 10 m and strongest gust, in km/h, and the
   * direction it mostly came from, in degrees (0 = from the north). Absent on
   * days cached before wind was fetched; null where Open-Meteo has no figure. */
  readonly windKmh?: number | null
  readonly gustKmh?: number | null
  readonly windFromDeg?: number | null
}

/**
 * A spot's cached weather: what the strip draws, and the two figures Find's
 * dry-spell question and the page read off it.
 */
export interface Weather {
  readonly tempC: number
  /** Whole days since it last rained; null: no rain in the fetched window. */
  readonly daysSinceRain: number | null
  /** null: no strip to draw — not fetched yet, or not read back correctly. */
  readonly days: readonly WeatherDay[] | null
  /** Metres, at the time of the fetch. Absent or null: not known. */
  readonly freezingLevelM?: number | null
}

/** Seven past days, today, two forecast days. */
export const STRIP_DAYS = 10

/** WMO weather interpretation codes, as Open-Meteo documents them. */
export function skyFromWmo(code: number | null | undefined): Sky | null {
  if (code === null || code === undefined) return null
  if (code === 0 || code === 1) return 'sereno'
  if (code === 2) return 'poco_nuvoloso'
  if (code === 3 || code === 45 || code === 48) return 'nuvoloso'
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'pioggia'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neve'
  if (code === 95 || code === 96 || code === 99) return 'temporale'
  return null
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

/** "Mar" for a Tuesday. Read at noon UTC so no timezone moves the day. */
export function weekdayShort(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00.000Z`).getUTCDay()]!
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Days read back from storage, checked whole: exactly ten, each of the shape
 * above. Anything else is null — the strip is left out rather than drawn from
 * a list somebody patched, the importer rule applied to our own cache.
 */
export function parseWeatherDays(value: unknown): WeatherDay[] | null {
  if (!Array.isArray(value) || value.length !== STRIP_DAYS) return null
  const days: WeatherDay[] = []
  for (const d of value as unknown[]) {
    if (typeof d !== 'object' || d === null) return null
    const { date, when, sky, rainMm, snowCm, windKmh, gustKmh, windFromDeg } = d as Record<string, unknown>
    if (typeof date !== 'string' || !DATE.test(date)) return null
    if (!WHENS.includes(when as DayWhen)) return null
    if (sky !== null && !SKIES.includes(sky as Sky)) return null
    if (rainMm !== null && typeof rainMm !== 'number') return null
    // Optional: days cached before snowfall was fetched have none, and are
    // still whole days. Present, it must be a number or null like the rain.
    if (snowCm !== undefined && snowCm !== null && typeof snowCm !== 'number') return null
    // The wind, likewise optional: days cached before it was fetched have none.
    for (const v of [windKmh, gustKmh, windFromDeg]) {
      if (v !== undefined && v !== null && typeof v !== 'number') return null
    }
    days.push({ date, when: when as DayWhen, sky: sky as Sky | null, rainMm: rainMm as number | null,
                ...(snowCm === undefined ? {} : { snowCm: snowCm as number | null }),
                ...(windKmh === undefined ? {} : { windKmh: windKmh as number | null }),
                ...(gustKmh === undefined ? {} : { gustKmh: gustKmh as number | null }),
                ...(windFromDeg === undefined ? {} : { windFromDeg: windFromDeg as number | null }) })
  }
  return days
}

/**
 * The altitude a route's weather is asked for, in whole metres: where it
 * starts — a crag's or a climb's base, otherwise its `partenza`. Open-Meteo
 * corrects its figures to this height; without one it corrects to the ground
 * under the coordinates, which on a pin dropped on the mountain above a crag
 * is a different climate — a wall at 780 m drawn under fresh snow.
 *
 * null: the route records neither, and the ground's height stands, as before.
 */
export function weatherAltitudeM(facts: StoredFacts): number | null {
  for (const id of ['quota_base', 'partenza']) {
    const value = facts[id]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  }
  return null
}

export interface WeatherSpot {
  readonly lat: number
  readonly lon: number
  readonly altitudeM: number | null
}

/**
 * Where a route's weather is asked for: its start, in position as in height.
 * A crag's or a climb's base is its own point. A route that starts at its
 * `partenza` starts where the car is left, which is the parking point where
 * one is recorded — an alpine route's own point is its summit — and its own
 * point otherwise, which for the routes that carry no parking point is their
 * start. null: no coordinates, so no weather.
 */
export function weatherSpot(route: {
  readonly lat: number | null; readonly lon: number | null
  readonly parkingLat: number | null; readonly parkingLon: number | null
  readonly facts: StoredFacts
}): WeatherSpot | null {
  const altitudeM = weatherAltitudeM(route.facts)
  const fromBase = typeof route.facts['quota_base'] === 'number'
  if (!fromBase && altitudeM !== null && route.parkingLat !== null && route.parkingLon !== null) {
    return { lat: route.parkingLat, lon: route.parkingLon, altitudeM }
  }
  if (route.lat === null || route.lon === null) return null
  return { lat: route.lat, lon: route.lon, altitudeM }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']

/** Where a wind comes from, as an Italian forecast says it: "N", "SO", "NO". */
export function compassIt(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!
}
