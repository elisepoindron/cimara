import type { WeatherDay } from './weather.ts'

/**
 * The two figures the conditions column states under its weather strip, both
 * arithmetic over values the page already has: the cached days, and the
 * route's coordinates and date. Nothing here reads a report.
 */

export interface LastRain {
  /** 0 today, 1 yesterday. Counted in the strip's own days, not in hours. */
  readonly daysAgo: number
  readonly mm: number
  /** The day's sky was snow, so the card says neve rather than pioggia. */
  readonly snow: boolean
}

/**
 * The most recent day, today or before, with any precipitation. Null when none
 * of the strip's past days had any, or there is no today to count from: the
 * strip sees seven days back and no further, and this says no more than it does.
 *
 * A day with no figure is skipped, as `daysSinceRainFrom` skips it: a gap is
 * evidence of neither rain nor dryness. Forecast days are never read.
 */
export function lastRain(days: readonly WeatherDay[]): LastRain | null {
  const today = days.findIndex(d => d.when === 'today')
  if (today < 0) return null

  for (let i = today; i >= 0; i--) {
    const day = days[i]!
    if (day.rainMm !== null && day.rainMm > 0) {
      return { daysAgo: today - i, mm: day.rainMm, snow: day.sky === 'neve' }
    }
  }
  return null
}

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const UNIX_EPOCH_JD = 2440587.5
const J2000 = 2451545

/**
 * When the sun sets at a point on a calendar day, as an instant. The sunrise
 * equation in its common form (mean anomaly, equation of centre, ecliptic
 * longitude, declination, hour angle at −0.833° for refraction and the sun's
 * radius): good to a minute or two at Italian latitudes, which is what a card
 * that says "16:52" needs. Terrain is not modelled — a valley sees the sun go
 * behind a ridge earlier — and the card makes no claim that it is.
 *
 * Null where the sun does not set that day (polar summer or winter), which no
 * Italian route reaches but the arithmetic must not pretend about.
 *
 * `date` is YYYY-MM-DD; `lon` is east-positive, as stored.
 */
export function sunset(lat: number, lon: number, date: string): Date | null {
  const midnight = Date.parse(`${date}T00:00:00.000Z`)
  if (Number.isNaN(midnight)) return null

  const n = Math.ceil(midnight / DAY_MS + UNIX_EPOCH_JD - J2000 + 0.0008)
  const meanSolar = n - lon / 360
  const anomaly = (357.5291 + 0.98560028 * meanSolar) % 360
  const centre = 1.9148 * Math.sin(anomaly * RAD) + 0.02 * Math.sin(2 * anomaly * RAD)
    + 0.0003 * Math.sin(3 * anomaly * RAD)
  const ecliptic = (anomaly + centre + 180 + 102.9372) % 360
  const transit = J2000 + meanSolar + 0.0053 * Math.sin(anomaly * RAD)
    - 0.0069 * Math.sin(2 * ecliptic * RAD)
  const sinDecl = Math.sin(ecliptic * RAD) * Math.sin(23.4397 * RAD)
  const cosDecl = Math.cos(Math.asin(sinDecl))
  const cosHour = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDecl)
    / (Math.cos(lat * RAD) * cosDecl)
  if (cosHour < -1 || cosHour > 1) return null

  const set = transit + Math.acos(cosHour) / RAD / 360
  return new Date(Math.round((set - UNIX_EPOCH_JD) * DAY_MS))
}

/**
 * Centimetres of fresh snow over the strip's past days and today, summed. Null
 * when no day carries a figure (cached before snowfall was fetched, or a gap
 * everywhere): unknown is not none. Forecast days are never read.
 */
export function freshSnow(days: readonly WeatherDay[]): number | null {
  const known = days.filter(d => d.when !== 'forecast' && d.snowCm !== undefined && d.snowCm !== null)
  if (known.length === 0) return null
  return known.reduce((sum, d) => sum + d.snowCm!, 0)
}
