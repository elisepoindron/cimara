import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastRain, sunset } from '../../src/domain/sky.ts'
import type { WeatherDay } from '../../src/domain/weather.ts'

const day = (date: string, when: WeatherDay['when'], rainMm: number | null, sky: WeatherDay['sky'] = 'sereno'): WeatherDay =>
  ({ date, when, rainMm, sky })

const strip = (mm: (number | null)[], skies: WeatherDay['sky'][] = []): WeatherDay[] => [
  ...mm.slice(0, 7).map((v, i) => day(`2026-11-${String(9 + i).padStart(2, '0')}`, 'past', v, skies[i] ?? 'sereno')),
  day('2026-11-16', 'today', mm[7] ?? 0, skies[7] ?? 'sereno'),
  day('2026-11-17', 'forecast', 30), day('2026-11-18', 'forecast', 30),
]

test('the last rain is counted back from today, in the strip’s own days', () => {
  assert.deepEqual(lastRain(strip([0, 16, 0, 52, 0, 0, 0, 0])), { daysAgo: 4, mm: 52, snow: false })
})

test('rain today is zero days ago', () => {
  assert.equal(lastRain(strip([0, 0, 0, 0, 0, 0, 0, 3]))!.daysAgo, 0)
})

test('forecast rain is never rain that fell', () => {
  assert.equal(lastRain(strip([0, 0, 0, 0, 0, 0, 0, 0])), null)
})

test('a day with no figure is a gap, not a dry day, and is skipped', () => {
  assert.equal(lastRain(strip([0, 0, 0, 9, 0, 0, null, 0]))!.daysAgo, 4)
})

test('a snowy day is said as snow', () => {
  const days = strip([0, 0, 0, 9, 0, 0, 0, 0], [null, null, null, 'neve'])
  assert.equal(lastRain(days)!.snow, true)
})

test('with no today there is nothing to count from', () => {
  assert.equal(lastRain(strip([5, 5, 5, 5, 5, 5, 5, 5]).filter(d => d.when !== 'today')), null)
})

const rome = (d: Date | null) =>
  d!.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })

// Published sunset times, to within the two minutes the equation is good for.
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const near = (got: string, want: string) =>
  assert.ok(Math.abs(minutes(got) - minutes(want)) <= 2, `${got} is not within two minutes of ${want}`)

test('sunset in Turin at midsummer', () => near(rome(sunset(45.07, 7.69, '2026-06-21')), '21:21'))
test('sunset in Rome at midwinter', () => near(rome(sunset(41.9, 12.5, '2026-12-21')), '16:42'))

test('a day the sun does not set is null, not a made-up time', () => {
  assert.equal(sunset(78.2, 15.6, '2026-06-21'), null)
})

test('a date nothing can read is null', () => {
  assert.equal(sunset(45, 7, 'domani'), null)
})

test('fresh snow sums the past days and today, never the forecast', async () => {
  const { freshSnow } = await import('../../src/domain/sky.ts')
  const days = strip([0, 6, 11, 0, 0, 0, 0, 0]).map((d, i) => ({ ...d, snowCm: i === 1 ? 6 : i === 2 ? 11 : i > 7 ? 40 : 0 }))
  assert.equal(freshSnow(days), 17)
  assert.equal(freshSnow(days.map(d => ({ ...d, snowCm: 0 }))), 0, 'none is a figure')
  assert.equal(freshSnow(strip([0, 0, 0, 0, 0, 0, 0, 0])), null, 'unknown is not none')
})
