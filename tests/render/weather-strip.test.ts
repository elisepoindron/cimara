import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { weatherStrip } from '../../src/render/weather-strip.ts'
import { STRIP_DAYS, type Weather, type WeatherDay } from '../../src/domain/weather.ts'

const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document
const countOf = (doc: Document, sel: string) => doc.querySelectorAll(sel).length
const texts = (doc: Document, sel: string) => [...doc.querySelectorAll(sel)].map(n => n.textContent!.trim())

const days = (over: Record<number, Partial<WeatherDay>> = {}): WeatherDay[] =>
  Array.from({ length: STRIP_DAYS }, (_, i) => ({
    date: `2026-09-${String(8 + i).padStart(2, '0')}`,
    when: i < 7 ? 'past' : i === 7 ? 'today' : 'forecast',
    sky: 'sereno', rainMm: 0, ...over[i],
  }))

const strip = (w: Partial<Weather> = {}) =>
  dom(render(weatherStrip({ tempC: 19, daysSinceRain: 4, days: days(), ...w })!))

test('ten columns, weekday names, today named Oggi', () => {
  const doc = strip()
  assert.deepEqual(texts(doc, '.wxs__d'), ['Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom', 'Lun', 'Oggi', 'Mer', 'Gio'])
  assert.equal(countOf(doc, '.wxs__today'), 1)
  assert.equal(countOf(doc, '.wxs__fc'), 2)
})

test('the header carries the current temperature', () => {
  assert.equal(strip().querySelector('.wxs__now')!.textContent, '19°C ora')
})

test('each sky icon names itself', () => {
  const doc = strip({ days: days({ 3: { sky: 'pioggia' }, 4: { sky: 'neve' } }) })
  const titles = texts(doc, '.wxs__days title')
  assert.equal(titles[3], 'Pioggia')
  assert.equal(titles[4], 'Neve')
  assert.equal(doc.querySelectorAll('.wxs__days svg')[3]!.getAttribute('aria-label'), 'Pioggia')
})

test('a day with no sky has no icon, and keeps its column', () => {
  const doc = strip({ days: days({ 2: { sky: null } }) })
  assert.equal(countOf(doc, '.wxs__days li'), 10)
  assert.equal(countOf(doc, '.wxs__days svg'), 9)
  assert.equal(countOf(doc, '.wxs__days li:nth-child(3) span.ic'), 1)
})

test('rain is a bar on the fixed 20 mm scale, with its figure', () => {
  const doc = strip({ days: days({ 2: { rainMm: 3 }, 3: { rainMm: 12 } }) })
  assert.deepEqual(texts(doc, '.wxs__mm'), ['', '', '3', '12', '', '', '', '', '', ''])
  const heights = [...doc.querySelectorAll('.wxs__well i')].map(i => i.getAttribute('style'))
  assert.deepEqual(heights, ['height:15%', 'height:60%'])
})

test('a day over 20 mm is capped at full height and keeps its true figure', () => {
  const doc = strip({ days: days({ 3: { rainMm: 34.6 } }) })
  assert.equal(doc.querySelector('.wxs__well i')!.getAttribute('style'), 'height:100%')
  assert.equal(texts(doc, '.wxs__mm')[3], '35')
})

test('a drizzle under half a millimetre still shows that it rained', () => {
  const doc = strip({ days: days({ 6: { rainMm: 0.2 } }) })
  assert.equal(texts(doc, '.wxs__mm')[6], '<1')
  assert.equal(doc.querySelector('.wxs__well i')!.getAttribute('style'), 'height:8%')
})

test('a day with no figure is a dash, not an empty bar', () => {
  const doc = strip({ days: days({ 5: { rainMm: null } }) })
  assert.equal(countOf(doc, '.wxs__well b'), 1)
  assert.equal(doc.querySelector('.wxs__well b')!.textContent, '–')
  assert.equal(countOf(doc, '.wxs__well i'), 0)
})

// The bars already show the dry spell; a sentence under them said it twice.
// The credit stays whatever the weather: Open-Meteo's data is CC BY.
test('the foot only credits the source, whatever the dry spell', () => {
  const foot = (daysSinceRain: number | null) =>
    texts(strip({ daysSinceRain }), '.wxs__f span')
  for (const d of [4, 1, 0, null]) assert.deepEqual(foot(d), ['Open-Meteo.com'])
})

test('the strip carries its own icons, once', () => {
  const doc = strip()
  assert.deepEqual([...doc.querySelectorAll('.wxs > svg.icons symbol')].map(s => s.getAttribute('id')),
    ['w-sereno', 'w-poco_nuvoloso', 'w-nuvoloso', 'w-pioggia', 'w-neve', 'w-temporale'])
})

test('no days, no strip', () => {
  assert.equal(weatherStrip({ tempC: 19, daysSinceRain: 4, days: null }), null)
})

test('under each day, an arrow pointing downwind and the strongest wind in km/h', () => {
  const doc = strip({ days: days({ 7: { windKmh: 23.6, gustKmh: 41.8, windFromDeg: 350 }, 8: { windKmh: 9, gustKmh: null, windFromDeg: 90 } }) })
  assert.equal(countOf(doc, '.wxs__w'), 2, 'only days with a wind figure')
  assert.deepEqual(texts(doc, '.wxs__w'), ['24', '9'])
  const [today, tomorrow] = [...doc.querySelectorAll('.wxs__w')]
  assert.equal(today!.getAttribute('title'), 'Vento da N, fino a 24 km/h, raffiche 42 km/h')
  assert.equal(tomorrow!.getAttribute('title'), 'Vento da E, fino a 9 km/h')
  // From 350 degrees, the arrow turns to 170: pointing south, where the wind goes.
  assert.match(today!.querySelector('svg')!.getAttribute('style')!, /rotate\(170deg\)/)
  assert.equal(doc.querySelector('.wxs__h .lab')!.textContent, 'Pioggia, cielo e vento')
})

test('a strip with no wind figures draws no wind and keeps its title', () => {
  const doc = strip()
  assert.equal(countOf(doc, '.wxs__w'), 0)
  assert.equal(doc.querySelector('.wxs__h .lab')!.textContent, 'Pioggia e cielo')
})
