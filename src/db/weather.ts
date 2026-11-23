import type { Db } from './open.ts'
import { parseWeatherDays, type WeatherDay } from '../domain/weather.ts'

export interface CachedWeather {
  readonly tempC: number
  readonly daysSinceRain: number | null
  readonly days: readonly WeatherDay[] | null
  readonly freezingLevelM: number | null
  readonly fetchedAt: string
}

interface NewWeather {
  readonly tempC: number
  readonly daysSinceRain: number | null
  /** Absent or null: no strip for this row. */
  readonly days?: readonly WeatherDay[] | null
  readonly freezingLevelM?: number | null
  readonly fetchedAt: string
}

/** The key column's value where no altitude was asked for: a key column cannot
 * hold null and still make two such rows one. Never read back as an altitude. */
const GROUND = -1

/** One row per rounded coordinate and altitude asked — a refresh replaces it
 * outright, guarded the same way synthesis.ts guards a race between two
 * concurrent fetches. */
export async function saveWeatherCache(
  db: Db, latR: number, lonR: number, altitudeM: number | null, data: NewWeather,
): Promise<void> {
  await db.run(
    `insert into weather_cache (lat_r, lon_r, alt_m, fetched_at, temp_c, days_since_rain, days, freezing_level_m)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (lat_r, lon_r, alt_m) do update set
       fetched_at = excluded.fetched_at,
       temp_c = excluded.temp_c,
       days_since_rain = excluded.days_since_rain,
       days = excluded.days,
       freezing_level_m = excluded.freezing_level_m
     where excluded.fetched_at >= weather_cache.fetched_at`,
    [latR, lonR, altitudeM ?? GROUND, data.fetchedAt, data.tempC, data.daysSinceRain,
     data.days ? JSON.stringify(data.days) : null, data.freezingLevelM ?? null])
}

interface RawWeather {
  fetched_at: string; temp_c: number; days_since_rain: number | null; days: string | null
  freezing_level_m: number | null
}

/** null: nothing has ever been cached for this coordinate at this altitude. */
export async function weatherCacheFor(
  db: Db, latR: number, lonR: number, altitudeM: number | null,
): Promise<CachedWeather | null> {
  const row = await db.get<RawWeather>(
    `select fetched_at, temp_c, days_since_rain, days, freezing_level_m
     from weather_cache where lat_r = ? and lon_r = ? and alt_m = ?`,
    [latR, lonR, altitudeM ?? GROUND])
  if (!row) return null
  return {
    tempC: row.temp_c, daysSinceRain: row.days_since_rain,
    days: readDays(row.days), freezingLevelM: row.freezing_level_m, fetchedAt: row.fetched_at,
  }
}

/** Stored JSON that does not parse, or parses into the wrong shape, is no days. */
function readDays(text: string | null): WeatherDay[] | null {
  if (text === null) return null
  try {
    return parseWeatherDays(JSON.parse(text))
  } catch {
    return null
  }
}
