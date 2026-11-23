import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysSinceRainFrom, weatherFrom, weatherUrl, type OpenMeteoResponse } from '../../src/app/weather-client.ts'

// The shape Open-Meteo returns for past_days=7&forecast_days=1: eight daily
// sums, the seven past days oldest first, then today last. No network here —
// the walk is arithmetic over the array.

test('no rain anywhere in the eight days is null', () => {
  assert.equal(daysSinceRainFrom([0, 0, 0, 0, 0, 0, 0, 0]), null)
})

test('rain two days before today counts back from today, the last entry', () => {
  assert.equal(daysSinceRainFrom([0, 0, 0, 0, 0, 3.2, 0, 0]), 2)
})

test('rain today is zero days since rain', () => {
  assert.equal(daysSinceRainFrom([0, 0, 0, 0, 0, 0, 0, 4.1]), 0)
})

test('the most recent rain wins over older rain', () => {
  assert.equal(daysSinceRainFrom([5, 0, 0, 1.2, 0, 0, 0.4, 0]), 1)
})

test('rain on the oldest day is seven days since rain', () => {
  assert.equal(daysSinceRainFrom([2, 0, 0, 0, 0, 0, 0, 0]), 7)
})

test('a missing day is skipped, not read as dry or as rain', () => {
  // Today's sum is missing: the walk passes over it and still counts from today.
  assert.equal(daysSinceRainFrom([0, 0, 0, 0, 0, 3.2, 0, null]), 2)
  assert.equal(daysSinceRainFrom([0, 0, 0, 0, 0, 0, 1.5, null]), 1)
  assert.equal(daysSinceRainFrom([0, 0, 0, null, 0, 0, 0, 0]), null)
})

// The shape Open-Meteo returns for past_days=7&forecast_days=3: ten daily
// entries, seven past days oldest first, today at index 7, two forecast days.

const TIME = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
  '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']

function response(over: Partial<OpenMeteoResponse['daily']> = {}): OpenMeteoResponse {
  return {
    current: { temperature_2m: 18.6, time: '2026-09-15T14:00' },
    daily: {
      time: TIME,
      weather_code: [0, 0, 61, 63, 3, 0, 0, 0, 2, 61],
      precipitation_sum: [0, 0, 3, 12, 0, 0, 0, 0, 0, 6],
      ...over,
    },
  }
}

test('forecast rain does not count as rain that fell', () => {
  // Rain on 10 and 11 September, and 6 mm forecast for the 17th: still four
  // days since rain, counted from today, the 15th.
  assert.equal(weatherFrom(response()).daysSinceRain, 4)
  const soaked = weatherFrom(response({ precipitation_sum: [0, 0, 0, 0, 0, 0, 0, 0, 20, 20] }))
  assert.equal(soaked.daysSinceRain, null, 'forecast rain alone leaves the past dry')
})

test('ten days come out in order, past, today, forecast', () => {
  const days = weatherFrom(response()).days!
  assert.deepEqual(days.map(d => d.when),
    ['past', 'past', 'past', 'past', 'past', 'past', 'past', 'today', 'forecast', 'forecast'])
  assert.deepEqual(days.map(d => d.date), TIME)
  assert.deepEqual(days[3], { date: '2026-09-11', when: 'past', sky: 'pioggia', rainMm: 12 })
})

test('the current temperature is whole degrees', () => {
  assert.equal(weatherFrom(response()).tempC, 19)
})

test('a day Open-Meteo has no figure for stays a gap', () => {
  const days = weatherFrom(response({
    weather_code: [0, 0, null, 63, 3, 0, 0, 0, 2, 61],
    precipitation_sum: [0, 0, null, 12, 0, 0, 0, 0, 0, 6],
  })).days!
  assert.equal(days[2]!.sky, null)
  assert.equal(days[2]!.rainMm, null)
})

test('any other number of days is no strip, and the signal still reads', () => {
  const short = weatherFrom(response({
    time: TIME.slice(0, 8),
    weather_code: [0, 0, 61, 63, 3, 0, 0, 0],
    precipitation_sum: [0, 0, 3, 12, 0, 0, 0, 0],
  }))
  assert.equal(short.days, null)
  assert.equal(short.tempC, 19)
  assert.equal(short.daysSinceRain, 4)
})

test('a response without sky codes still gives the signal, and no strip', () => {
  const data = response()
  const { weather_code: _, ...daily } = data.daily
  const w = weatherFrom({ ...data, daily: daily as OpenMeteoResponse['daily'] })
  assert.equal(w.days, null)
  assert.equal(w.tempC, 19)
  assert.equal(w.daysSinceRain, 4)
})

test('today is found by its date, so forecast rain never counts when the past is short', () => {
  // Five past days, today, two forecast: today is at index 5, not 7, and the
  // rain on the 16th is a forecast.
  const w = weatherFrom(response({
    time: ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14',
      '2026-09-15', '2026-09-16', '2026-09-17'],
    weather_code: [0, 0, 0, 0, 0, 0, 61, 61],
    precipitation_sum: [0, 0, 0, 0, 0, 0, 8, 8],
  }))
  assert.equal(w.daysSinceRain, null)
  assert.equal(w.days, null)
})

test('a response whose days do not include today is refused, not guessed', () => {
  const data = response()
  assert.throws(() => weatherFrom({ ...data, current: { ...data.current, time: '2026-10-02T09:00' } }),
    /today/)
})

test('the freezing level is read off the current reading, and snowfall per day', () => {
  const w = weatherFrom({ ...response({ snowfall_sum: [0, 6, 11, 0, 0, 0, 0, 0, 2, 0] }),
    current: { temperature_2m: -4, time: '2026-09-15T14:00', freezing_level_height: 3612 } })
  assert.equal(w.freezingLevelM, 3612)
  assert.deepEqual(w.days!.map(d => d.snowCm), [0, 6, 11, 0, 0, 0, 0, 0, 2, 0])
})

test('a response that was not asked for them carries neither, as unknown', () => {
  const w = weatherFrom(response())
  assert.equal(w.freezingLevelM, null)
  assert.equal(w.days!.every(d => !('snowCm' in d)), true)
})

test('the request names the altitude when there is one', () => {
  const url = new URL(weatherUrl(45.06, 7.15, 780))
  assert.equal(url.searchParams.get('elevation'), '780')
  assert.equal(url.searchParams.get('latitude'), '45.06')
  assert.equal(url.searchParams.get('past_days'), '7')
})

test('without an altitude the request leaves elevation out, and Open-Meteo uses the ground', () => {
  assert.equal(new URL(weatherUrl(45.06, 7.15, null)).searchParams.has('elevation'), false)
})

test('each day carries its strongest wind, gust and where the wind came from', () => {
  const w = weatherFrom(response({
    wind_speed_10m_max: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28],
    wind_gusts_10m_max: [20, 22, 24, 26, 28, 30, 32, 42, 46, 48],
    wind_direction_10m_dominant: [0, 45, 90, 135, 180, 225, 270, 350, null, 10],
  }))
  const today = w.days!.find(d => d.when === 'today')!
  assert.deepEqual([today.windKmh, today.gustKmh, today.windFromDeg], [24, 42, 350])
  assert.equal(w.days![8]!.windFromDeg, null, 'a gap stays a gap')
})

test('a response without wind gives days without it', () => {
  assert.equal('windKmh' in weatherFrom(response()).days![0]!, false)
})

test('the request asks for the day\'s wind', () => {
  const daily = new URL(weatherUrl(45.06, 7.15, 780)).searchParams.get('daily')!.split(',')
  for (const v of ['wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant']) {
    assert.ok(daily.includes(v), v)
  }
})
