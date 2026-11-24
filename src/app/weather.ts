import type { Db } from '../db/open.ts'
import { saveWeatherCache, weatherCacheFor } from '../db/weather.ts'
import type { Weather } from '../domain/weather.ts'

/** `altitudeM` null: no altitude is sent, and Open-Meteo uses the ground's. */
export type FetchWeather = (lat: number, lon: number, altitudeM: number | null) => Promise<Weather>

const TTL_MS = 60 * 60 * 1000
/**
 * How old the strip's days may be. A failed refresh keeps serving the last
 * row, and past midnight that row's "today" is yesterday: the signal is still
 * the best there is, but the strip would name the wrong day, so it goes.
 */
const STRIP_MAX_AGE_MS = 3 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * How long a page may wait for the fetch when it has nothing usable to draw:
 * no row at all, or a row whose strip is too old to show. Past it the page is
 * drawn without the strip, as before, and the fetch still lands in the cache.
 */
export const FIRST_FETCH_WAIT_MS = 2500

export interface WeatherOpts {
  /** Wait at most this long for a fetch when nothing usable is cached. 0, the default: never wait. */
  readonly waitMs?: number
}

/**
 * Cache-or-refetch. A fresh cached row is returned as-is; a stale or missing
 * one triggers a refresh. That refresh is fire-and-forget while the cache
 * still has a strip to draw. When it has none — a route nobody has opened
 * yet, or one last fetched more than three hours ago — a caller that passes
 * `waitMs` waits that long for it, so a route's first visit is not a page
 * without weather; a fetch that fails or is slower falls back to the cache.
 */
export async function weatherFor(
  db: Db, lat: number, lon: number, altitudeM: number | null, now: Date, fetchWeather: FetchWeather,
  opts: WeatherOpts = {},
): Promise<Weather | null> {
  const latR = round2(lat)
  const lonR = round2(lon)
  const cached = await weatherCacheFor(db, latR, lonR, altitudeM)
  const age = cached === null ? Infinity : now.getTime() - Date.parse(cached.fetchedAt)
  const fresh = age < TTL_MS

  if (!fresh) {
    const refresh = fetchWeather(lat, lon, altitudeM).then(async w => {
      await saveWeatherCache(db, latR, lonR, altitudeM, { ...w, fetchedAt: now.toISOString() })
      return w
    })
    refresh.catch(err => console.error('weather fetch failed, keeping the previous cache:', err))

    const waitMs = opts.waitMs ?? 0
    if (age >= STRIP_MAX_AGE_MS && waitMs > 0) {
      const landed = await within(refresh.catch(() => null), waitMs)
      if (landed !== null) {
        return { tempC: landed.tempC, daysSinceRain: landed.daysSinceRain,
          days: landed.days, freezingLevelM: landed.freezingLevelM ?? null }
      }
    }
  }

  return cached === null ? null
    : { tempC: cached.tempC, daysSinceRain: cached.daysSinceRain,
        days: age < STRIP_MAX_AGE_MS ? cached.days : null,
        // A reading of "now", stale by the same rule as the strip's "today".
        freezingLevelM: age < STRIP_MAX_AGE_MS ? cached.freezingLevelM : null }
}

/** The promise's value if it settles within `ms`, null otherwise. The timer never holds the process open. */
export async function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), ms)
    timer.unref?.()
  })
  try { return await Promise.race([p, timeout]) } finally { clearTimeout(timer) }
}
