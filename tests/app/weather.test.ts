import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weatherFor, type FetchWeather } from '../../src/app/weather.ts'
import { saveWeatherCache, weatherCacheFor } from '../../src/db/weather.ts'
import { freshDb } from '../helpers/db.ts'
import { STRIP_DAYS, type WeatherDay } from '../../src/domain/weather.ts'

test('nothing cached: returns null, still triggers a fetch', async () => {
  const db = await freshDb()
  let calls = 0
  const fetchWeather: FetchWeather = async () => { calls++; return { tempC: 20, daysSinceRain: 1, days: null } }

  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather)

  assert.equal(result, null, 'a first-ever request has nothing to return synchronously')
  assert.equal(calls, 1)
})

test('a fresh cached row is used as-is, no fetch triggered', async () => {
  const db = await freshDb()
  const now = new Date('2026-09-18T10:00:00.000Z')
  let calls = 0
  const fetchWeather: FetchWeather = async () => { calls++; return { tempC: 99, daysSinceRain: 99, days: null } }

  await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T09:45:00.000Z'), fetchWeather)
  await new Promise(r => setTimeout(r, 0))   // let the background save land
  calls = 0

  const result = await weatherFor(db, 44.6708, 7.0958, null, now, fetchWeather)

  // What the setup call above actually cached (99), not test 1's mock value —
  // the brief's own draft had this as 20, a copy-paste leftover from the
  // previous test; see the task-6 report for the full note.
  assert.equal(result?.tempC, 99)
  assert.equal(calls, 0, 'fifteen minutes old, under the one-hour TTL')
})

test('a stale cached row is returned, and a background refresh fires', async () => {
  const db = await freshDb()
  const stale = new Date('2026-09-18T08:00:00.000Z')
  const now = new Date('2026-09-18T10:00:00.000Z')   // two hours later
  let calls = 0
  const fetchWeather: FetchWeather = async () => { calls++; return { tempC: 25, daysSinceRain: 0, days: null } }

  await weatherFor(db, 44.6708, 7.0958, null, stale, fetchWeather)
  await new Promise(r => setTimeout(r, 0))
  calls = 0   // isolate the second call's own trigger, as test 2 already does

  const result = await weatherFor(db, 44.6708, 7.0958, null, now, fetchWeather)

  // 25 is what the setup call above actually cached — the stale value this
  // call must still return synchronously, before the background refresh
  // (also mocked to 25 here) lands. The brief's own draft had 20, the same
  // copy-paste leftover as the previous test; see the task-6 report.
  assert.equal(result?.tempC, 25, 'the stale value is still what this call returns')
  assert.equal(calls, 1, 'a background refresh was triggered')
})

test('a rejected fetch is caught, never thrown, and leaves the previous cache untouched', async () => {
  const db = await freshDb()
  const now = new Date('2026-09-18T10:00:00.000Z')
  const failing: FetchWeather = async () => { throw new Error('network down') }

  const result = await weatherFor(db, 44.6708, 7.0958, null, now, failing)
  await new Promise(r => setTimeout(r, 0))

  assert.equal(result, null)
  assert.equal(await weatherCacheFor(db, 44.67, 7.1, null), null)
})

test('the days the fetch brought back are what the next read returns', async () => {
  const db = await freshDb()
  const days: WeatherDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => ({
    date: `2026-09-${String(8 + i).padStart(2, '0')}`,
    when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast', sky: 'sereno', rainMm: 0,
  }))
  const fetchWeather: FetchWeather = async () => ({ tempC: 19, daysSinceRain: null, days })

  await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T09:45:00.000Z'), fetchWeather)
  await new Promise(r => setTimeout(r, 0))
  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather)

  assert.deepEqual(result?.days, days)
})

test('days fetched more than three hours ago are no strip; the signal is still served', async () => {
  // An outage keeps the last row alive. Past midnight its "today" is yesterday,
  // so the strip is dropped rather than drawn wrong; the signal stays.
  const db = await freshDb()
  const days: WeatherDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => ({
    date: `2026-09-${String(8 + i).padStart(2, '0')}`,
    when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast', sky: 'sereno', rainMm: 0,
  }))
  await saveWeatherCache(db, 44.67, 7.1, null, {
    tempC: 19, daysSinceRain: 2, days, fetchedAt: '2026-09-18T06:00:00.000Z',
  })
  const failing: FetchWeather = async () => { throw new Error('network down') }

  const at = (iso: string) => weatherFor(db, 44.6708, 7.0958, null, new Date(iso), failing)
  assert.deepEqual((await at('2026-09-18T08:59:00.000Z'))?.days, days, 'under three hours')
  const late = await at('2026-09-18T09:01:00.000Z')
  assert.equal(late?.days, null)
  assert.equal(late?.tempC, 19)
  await new Promise(r => setTimeout(r, 0))
})

const stripDays: WeatherDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => ({
  date: `2026-09-${String(8 + i).padStart(2, '0')}`,
  when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast', sky: 'sereno', rainMm: 0,
}))

test('nothing cached, waiting allowed: the first visit gets the fetch itself', async () => {
  const db = await freshDb()
  const fetchWeather: FetchWeather = async () => ({ tempC: 14, daysSinceRain: 2, days: stripDays, freezingLevelM: 2900 })

  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather, { waitMs: 1000 })

  assert.equal(result?.tempC, 14)
  assert.deepEqual(result?.days, stripDays)
  assert.equal(result?.freezingLevelM, 2900)
  assert.equal((await weatherCacheFor(db, 44.67, 7.1, null))?.tempC, 14, 'and it is cached for the next visit')
})

test('a strip too old to draw, waiting allowed: the refresh is waited for', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.1, null, {
    tempC: 3, daysSinceRain: 9, days: stripDays, fetchedAt: '2026-09-17T18:00:00.000Z',
  })
  const fetchWeather: FetchWeather = async () => ({ tempC: 16, daysSinceRain: 0, days: stripDays })

  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather, { waitMs: 1000 })

  assert.equal(result?.tempC, 16)
  assert.deepEqual(result?.days, stripDays)
})

test('a stale row that still has its strip is served at once, even when waiting is allowed', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.1, null, {
    tempC: 3, daysSinceRain: 9, days: stripDays, fetchedAt: '2026-09-18T08:30:00.000Z',
  })
  let release!: () => void
  const fetchWeather: FetchWeather = () => new Promise(r => { release = () => r({ tempC: 16, daysSinceRain: 0, days: null }) })

  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather, { waitMs: 1000 })

  assert.equal(result?.tempC, 3, 'ninety minutes old: stale, but the strip is still drawable')
  release()
  await new Promise(r => setTimeout(r, 0))
})

test('a fetch slower than the wait falls back to the cache, and still lands', async () => {
  const db = await freshDb()
  let release!: () => void
  const fetchWeather: FetchWeather = () => new Promise(r => { release = () => r({ tempC: 11, daysSinceRain: 1, days: null }) })

  const started = Date.now()
  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), fetchWeather, { waitMs: 20 })

  assert.equal(result, null)
  assert.ok(Date.now() - started < 1000, 'the wait is bounded')
  release()
  await new Promise(r => setTimeout(r, 5))
  assert.equal((await weatherCacheFor(db, 44.67, 7.1, null))?.tempC, 11)
})

test('a failing fetch, waiting allowed: no throw, the cache as it was', async () => {
  const db = await freshDb()
  const failing: FetchWeather = async () => { throw new Error('network down') }

  const result = await weatherFor(db, 44.6708, 7.0958, null, new Date('2026-09-18T10:00:00.000Z'), failing, { waitMs: 1000 })

  assert.equal(result, null)
})

test('the altitude is asked for and keys the cache', async () => {
  const db = await freshDb()
  const asked: (number | null)[] = []
  const fetchWeather: FetchWeather = async (_lat, _lon, altitudeM) => {
    asked.push(altitudeM)
    return { tempC: altitudeM === null ? -2 : 10, daysSinceRain: 1, days: null }
  }
  const now = new Date('2026-09-18T10:00:00.000Z')

  await weatherFor(db, 45.06, 7.15, 780, now, fetchWeather, { waitMs: 1000 })
  assert.deepEqual(asked, [780])
  assert.equal((await weatherCacheFor(db, 45.06, 7.15, 780))?.tempC, 10)
  assert.equal(await weatherCacheFor(db, 45.06, 7.15, null), null, 'not under the ground\'s key')

  // The same crag at the same altitude is answered from the row, without a call.
  await weatherFor(db, 45.06, 7.15, 780, now, fetchWeather)
  assert.deepEqual(asked, [780])
})
