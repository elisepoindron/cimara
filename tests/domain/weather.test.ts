import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  skyFromWmo, weekdayShort, parseWeatherDays, SKY_LABELS, STRIP_DAYS, type WeatherDay, weatherAltitudeM, weatherSpot, compassIt,
} from '../../src/domain/weather.ts'

test('each WMO code group maps to its sky', () => {
  assert.equal(skyFromWmo(0), 'sereno')
  assert.equal(skyFromWmo(1), 'sereno')
  assert.equal(skyFromWmo(2), 'poco_nuvoloso')
  assert.equal(skyFromWmo(3), 'nuvoloso')
  for (const c of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]) assert.equal(skyFromWmo(c), 'pioggia', String(c))
  for (const c of [71, 73, 75, 77, 85, 86]) assert.equal(skyFromWmo(c), 'neve', String(c))
  for (const c of [95, 96, 99]) assert.equal(skyFromWmo(c), 'temporale', String(c))
})

test('fog folds into nuvoloso', () => {
  assert.equal(skyFromWmo(45), 'nuvoloso')
  assert.equal(skyFromWmo(48), 'nuvoloso')
})

test('a missing or unknown code has no sky rather than a guessed one', () => {
  assert.equal(skyFromWmo(null), null)
  assert.equal(skyFromWmo(undefined), null)
  assert.equal(skyFromWmo(4), null)
  assert.equal(skyFromWmo(100), null)
})

test('every sky has an Italian name', () => {
  assert.deepEqual(Object.values(SKY_LABELS),
    ['Sereno', 'Poco nuvoloso', 'Nuvoloso', 'Pioggia', 'Neve', 'Temporale'])
})

test('weekday names, from the date alone', () => {
  // 15 September 2026 is a Tuesday.
  assert.deepEqual(
    ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']
      .map(weekdayShort),
    ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'])
})

const day = (i: number, over: Partial<WeatherDay> = {}): WeatherDay => ({
  date: `2026-09-${String(8 + i).padStart(2, '0')}`,
  when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast',
  sky: 'sereno', rainMm: 0, ...over,
})
const TEN = Array.from({ length: STRIP_DAYS }, (_, i) => day(i))

test('ten well-formed days read back as they are', () => {
  assert.deepEqual(parseWeatherDays(JSON.parse(JSON.stringify(TEN))), TEN)
})

test('null sky and null rain are kept, not filled in', () => {
  const days = TEN.map((d, i) => i === 3 ? { ...d, sky: null, rainMm: null } : d)
  assert.deepEqual(parseWeatherDays(days), days)
})

test('anything else is no days at all, never a repaired list', () => {
  assert.equal(parseWeatherDays(null), null)
  assert.equal(parseWeatherDays('nope'), null)
  assert.equal(parseWeatherDays(TEN.slice(0, 9)), null, 'nine days')
  assert.equal(parseWeatherDays([...TEN, day(10)]), null, 'eleven days')
  assert.equal(parseWeatherDays(TEN.map((d, i) => i === 0 ? { ...d, date: '8 settembre' } : d)), null)
  assert.equal(parseWeatherDays(TEN.map((d, i) => i === 0 ? { ...d, when: 'ieri' } : d)), null)
  assert.equal(parseWeatherDays(TEN.map((d, i) => i === 0 ? { ...d, sky: 'grandine' } : d)), null)
  assert.equal(parseWeatherDays(TEN.map((d, i) => i === 0 ? { ...d, rainMm: '3' } : d)), null)
})

test('a crag\'s weather is asked at its base', () => {
  assert.equal(weatherAltitudeM({ quota_base: 780, esposizione: 'S' }), 780)
})

test('a route without a base is asked at its start', () => {
  assert.equal(weatherAltitudeM({ partenza: 2020, vetta: 3841 }), 2020)
})

test('the base wins over the start where a route records both', () => {
  assert.equal(weatherAltitudeM({ quota_base: 900, partenza: 620 }), 900)
})

test('no recorded altitude asks for none, and a non-number is not one', () => {
  assert.equal(weatherAltitudeM({ vetta: 3000 }), null)
  assert.equal(weatherAltitudeM({ quota_base: '780' }), null)
  assert.equal(weatherAltitudeM({ quota_base: Number.NaN }), null)
})

test('the altitude is whole metres', () => {
  assert.equal(weatherAltitudeM({ quota_base: 1349.6 }), 1350)
})

const route = (over: Partial<Parameters<typeof weatherSpot>[0]>) =>
  ({ lat: 44.6673, lon: 7.0913, parkingLat: null, parkingLon: null, facts: {}, ...over })

test('an alpine route\'s weather is asked where it starts: its parking, at its partenza', () => {
  assert.deepEqual(weatherSpot(route({ parkingLat: 44.69938, parkingLon: 7.15609, facts: { partenza: 2020, vetta: 3841 } })),
    { lat: 44.69938, lon: 7.15609, altitudeM: 2020 })
})

test('a crag\'s weather is asked at its wall, not where the car is left', () => {
  assert.deepEqual(weatherSpot(route({ lat: 45.06, lon: 7.15, parkingLat: 45.0587, parkingLon: 7.1443, facts: { quota_base: 780 } })),
    { lat: 45.06, lon: 7.15, altitudeM: 780 })
})

test('a route whose point is its start, with no parking recorded, is asked there', () => {
  assert.deepEqual(weatherSpot(route({ lat: 44.9596, lon: 6.8835, facts: { partenza: 2035, vetta: 2658 } })),
    { lat: 44.9596, lon: 6.8835, altitudeM: 2035 })
})

test('no recorded start keeps the route\'s own point and the ground\'s height', () => {
  assert.deepEqual(weatherSpot(route({ parkingLat: 44.69, parkingLon: 7.15 })), { lat: 44.6673, lon: 7.0913, altitudeM: null })
})

test('a route with no coordinates and no parking has no weather', () => {
  assert.equal(weatherSpot(route({ lat: null, lon: null, facts: { partenza: 2000 } })), null)
})

test('a wind direction reads as an Italian compass point', () => {
  assert.deepEqual([0, 44, 46, 90, 180, 225, 270, 315, 359, 360, -45].map(compassIt),
    ['N', 'NE', 'NE', 'E', 'S', 'SO', 'O', 'NO', 'N', 'N', 'NO'])
})

const tenDays = (extra: Record<string, unknown> = {}) => Array.from({ length: STRIP_DAYS }, (_, i) => ({
  date: `2026-09-${String(8 + i).padStart(2, '0')}`, when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast',
  sky: 'sereno', rainMm: 0, ...extra,
}))

test('cached days keep their wind, and days cached before it read without', () => {
  const back = parseWeatherDays(tenDays({ windKmh: 24, gustKmh: 42, windFromDeg: 350 }))!
  assert.equal(back[0]!.windKmh, 24)
  assert.equal(back[0]!.gustKmh, 42)
  assert.equal(back[0]!.windFromDeg, 350)
  assert.equal('windKmh' in parseWeatherDays(tenDays())![0]!, false)
})

test('a wind that is not a number is not a day', () => {
  assert.equal(parseWeatherDays(tenDays({ windKmh: '24' })), null)
})
