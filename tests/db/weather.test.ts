import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { saveWeatherCache, weatherCacheFor } from '../../src/db/weather.ts'
import { STRIP_DAYS, type WeatherDay } from '../../src/domain/weather.ts'

test('nothing cached yet reads back as null', async () => {
  const db = await freshDb()
  assert.equal(await weatherCacheFor(db, 44.67, 7.09, null), null)
})

test('a saved reading reads back whole', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, {
    tempC: 18.5, daysSinceRain: 2, fetchedAt: '2026-09-18T10:00:00.000Z',
  })

  const row = await weatherCacheFor(db, 44.67, 7.09, null)
  assert.equal(row?.tempC, 18.5)
  assert.equal(row?.daysSinceRain, 2)
  assert.equal(row?.fetchedAt, '2026-09-18T10:00:00.000Z')
})

test('saving again replaces the row rather than adding a second one', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 10, daysSinceRain: 0, fetchedAt: 'a' })
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 20, daysSinceRain: null, fetchedAt: 'b' })

  const rows = await db.all('select * from weather_cache where lat_r = ? and lon_r = ?', [44.67, 7.09])
  assert.equal(rows.length, 1)
  const row = await weatherCacheFor(db, 44.67, 7.09, null)
  assert.equal(row?.tempC, 20)
  assert.equal(row?.daysSinceRain, null)
})

test('a write older than the row already there does not land', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 20, daysSinceRain: 1, fetchedAt: '2026-09-18T10:00:00.000Z' })
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 5, daysSinceRain: 5, fetchedAt: '2026-09-18T09:00:00.000Z' })

  const row = await weatherCacheFor(db, 44.67, 7.09, null)
  assert.equal(row?.tempC, 20)
})

test('different rounded coordinates are different rows', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 20, daysSinceRain: null, fetchedAt: 'a' })
  assert.equal(await weatherCacheFor(db, 45.00, 7.09, null), null)
})

const TEN: WeatherDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => ({
  date: `2026-09-${String(8 + i).padStart(2, '0')}`,
  when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast',
  sky: i === 3 ? 'pioggia' : 'sereno',
  rainMm: i === 3 ? 12 : 0,
}))

test('the days round-trip', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 18, daysSinceRain: 4, days: TEN, fetchedAt: 'a' })
  assert.deepEqual((await weatherCacheFor(db, 44.67, 7.09, null))?.days, TEN)
})

test('a row saved without days reads back with none, and its signal intact', async () => {
  // The shape every row cached before migration 015 has.
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 18, daysSinceRain: 4, fetchedAt: 'a' })
  const row = await weatherCacheFor(db, 44.67, 7.09, null)
  assert.equal(row?.days, null)
  assert.equal(row?.tempC, 18)
  assert.equal(row?.daysSinceRain, 4)
})

test('stored days that do not read back correctly are no days', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: 18, daysSinceRain: 4, fetchedAt: 'a' })
  for (const bad of ['{not json', '[]', JSON.stringify(TEN.slice(0, 9))]) {
    await db.run('update weather_cache set days = ? where lat_r = ? and lon_r = ?', [bad, 44.67, 7.09])
    assert.equal((await weatherCacheFor(db, 44.67, 7.09, null))?.days, null, bad)
  }
})

test('the freezing level and each day’s snow round-trip; an older row reads them as unknown', async () => {
  const db = await freshDb()
  const snowy = TEN.map((d, i) => ({ ...d, snowCm: i === 2 ? 11 : 0 }))
  await saveWeatherCache(db, 44.67, 7.09, null, { tempC: -4, daysSinceRain: 4, days: snowy, freezingLevelM: 3200, fetchedAt: 'a' })
  const back = (await weatherCacheFor(db, 44.67, 7.09, null))!
  assert.equal(back.freezingLevelM, 3200)
  assert.equal(back.days![2]!.snowCm, 11)

  await saveWeatherCache(db, 45.06, 7.15, null, { tempC: 8, daysSinceRain: 1, days: TEN, fetchedAt: 'a' })
  const old = (await weatherCacheFor(db, 45.06, 7.15, null))!
  assert.equal(old.freezingLevelM, null)
  assert.equal(old.days!.length, STRIP_DAYS, 'days with no snow figure are still whole days')
})

test('the same coordinates at two altitudes are two rows', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 45.06, 7.15, 780, { tempC: 10, daysSinceRain: 1, fetchedAt: 'a' })
  await saveWeatherCache(db, 45.06, 7.15, 2400, { tempC: -2, daysSinceRain: 1, fetchedAt: 'a' })

  assert.equal((await weatherCacheFor(db, 45.06, 7.15, 780))?.tempC, 10)
  assert.equal((await weatherCacheFor(db, 45.06, 7.15, 2400))?.tempC, -2)
})

test('no altitude is a row of its own, and saving it again replaces it', async () => {
  const db = await freshDb()
  await saveWeatherCache(db, 45.06, 7.15, null, { tempC: 3, daysSinceRain: 1, fetchedAt: 'a' })
  await saveWeatherCache(db, 45.06, 7.15, null, { tempC: 4, daysSinceRain: 1, fetchedAt: 'b' })

  assert.equal((await weatherCacheFor(db, 45.06, 7.15, null))?.tempC, 4)
  assert.equal(await weatherCacheFor(db, 45.06, 7.15, 780), null)
  const rows = await db.all('select * from weather_cache')
  assert.equal(rows.length, 1)
})
