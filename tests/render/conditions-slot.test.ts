import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { conditionsSlot } from '../../src/render/conditions-slot.ts'
import type { Weather, WeatherDay } from '../../src/domain/weather.ts'

// Never assert a DOM node against null (see CLAUDE.md): count, or read text.
const countOf = (doc: Document, sel: string) => doc.querySelectorAll(sel).length
const texts = (doc: Document, sel: string) => [...doc.querySelectorAll(sel)].map(n => n.textContent!.replace(/\s+/g, ' ').trim())
const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document

const NOW = new Date('2026-11-16T10:00:00.000Z')
const AT = { lat: 45.14, lon: 7.15 }

const days = (mm: number[], skies: WeatherDay['sky'][] = []): WeatherDay[] => [
  ...mm.map((v, i) => ({ date: `2026-11-${String(9 + i).padStart(2, '0')}`, when: 'past' as const, sky: skies[i] ?? 'sereno', rainMm: v })),
  { date: '2026-11-16', when: 'today', sky: 'sereno', rainMm: 0 },
  { date: '2026-11-17', when: 'forecast', sky: 'pioggia', rainMm: 8 },
  { date: '2026-11-18', when: 'forecast', sky: 'sereno', rainMm: 0 },
]
const weather = (d: WeatherDay[] | null): Weather => ({ tempC: 8, daysSinceRain: null, days: d })

const slot = (w: Weather | null, at: { lat: number | null; lon: number | null } = AT) =>
  dom(render(conditionsSlot({ now: NOW, weather: w, ...at })!))

test('the column is titled Adesso and holds the strip, then the cards', () => {
  const doc = slot(weather(days([0, 16, 0, 52, 0, 6, 9])))
  assert.deepEqual(texts(doc, 'h2'), ['Adesso'])
  const children = [...doc.querySelector('.cond')!.children].map(c => c.className)
  assert.deepEqual(children, ['wxs', 'cgrid'])
})

test('the cards say when it last rained and when the sun sets', () => {
  const doc = slot(weather(days([0, 16, 0, 52, 0, 6, 9])))
  assert.deepEqual(texts(doc, '.cgrid dt'), ['Ultima pioggia', 'Tramonto'])
  assert.deepEqual(texts(doc, '.cgrid dd')[0], 'Ieri9 mm')
  assert.match(texts(doc, '.cgrid dd')[1]!, /^1[67]:\d\d$/)
})

test('rain days ago reads as a count with its millimetres', () => {
  const doc = slot(weather(days([0, 0, 0, 12, 0, 0, 0])))
  assert.equal(texts(doc, '.cgrid dd')[0], '4giorni fa · 12 mm')
})

test('a week without rain says so rather than leaving the card out', () => {
  const doc = slot(weather(days([0, 0, 0, 0, 0, 0, 0])))
  assert.equal(texts(doc, '.cgrid dd')[0], 'Nessunain 7 giorni')
})

test('snow is called snow', () => {
  const doc = slot(weather(days([0, 0, 0, 9, 0, 0, 0], [null, null, null, 'neve'])))
  assert.equal(texts(doc, '.cgrid dt')[0], 'Ultima neve')
})

test('before the first weather fetch, the sunset still stands alone', () => {
  const doc = slot(null)
  assert.equal(countOf(doc, '.wxs'), 0)
  assert.deepEqual(texts(doc, '.cgrid dt'), ['Tramonto'])
})

test('a route with no coordinates has no column', () => {
  assert.equal(conditionsSlot({ now: NOW, weather: null, lat: null, lon: null }), null)
})

test('nothing in the column is a verdict or a report', () => {
  const html = render(conditionsSlot({ now: NOW, weather: weather(days([0, 16, 0, 52, 0, 6, 9])), ...AT })!)
  assert.doesNotMatch(html, /buone|ottime|variabili|osservazion|relazion|Dalle ultime gite/i)
})

test('a mountain adds the freezing level and the fresh snow, in the order its activity declares', () => {
  const snowy = days([0, 6, 11, 0, 0, 0, 0], [null, 'neve', 'neve']).map((d, i) => ({ ...d, snowCm: i === 1 ? 6 : i === 2 ? 11 : 0 }))
  const doc = dom(render(conditionsSlot({ now: NOW, ...AT, figures: ['zero_termico', 'neve_fresca'],
    weather: { ...weather(snowy), freezingLevelM: 3612 } })!))
  assert.deepEqual(texts(doc, '.cgrid dt'), ['Ultima neve', 'Tramonto', 'Zero termico', 'Neve fresca'])
  assert.deepEqual(texts(doc, '.cgrid dd').slice(2), ['3600m', '17cm in 7 giorni'])
})

test('a figure nothing is known about is left out, and a crag asks for neither', () => {
  const doc = dom(render(conditionsSlot({ now: NOW, ...AT, figures: ['zero_termico', 'neve_fresca'],
    weather: weather(days([0, 0, 0, 0, 0, 0, 0])) })!))
  assert.deepEqual(texts(doc, '.cgrid dt'), ['Ultima pioggia', 'Tramonto'])
  const crag = slot({ ...weather(days([0, 0, 0, 0, 0, 0, 0])), freezingLevelM: 3000 })
  assert.equal(texts(crag, '.cgrid dt').includes('Zero termico'), false)
})

const STATIONS = [
  { network: 'cf-vda', code: '3000', name: 'Verrès-Capoluogo', altM: 375, distanceM: 3200 },
  { network: 'cf-vda', code: '1310', name: 'Hône-Dora', altM: 340, distanceM: 800 },
]
const withStations = (stations: typeof STATIONS, altitudeM: number | null = 500) =>
  dom(render(conditionsSlot({ now: NOW, weather: weather(days([0, 0, 0, 0, 0, 0, 0])), ...AT, stations, altitudeM })!))

test('nearby stations sit folded under the figures, each linked to its own page', () => {
  const doc = withStations(STATIONS)
  assert.equal(countOf(doc, '.cond > details.stz'), 1)
  assert.equal(countOf(doc, 'details.stz[open]'), 0, 'closed until asked for')
  assert.deepEqual(texts(doc, '.stz summary'), ['Stazioni meteo vicine2'])
  assert.deepEqual([...doc.querySelectorAll('.stz .near a')].map(a => a.getAttribute('href')), [
    'https://presidi2.regione.vda.it/str_dataview_station/3000',
    'https://presidi2.regione.vda.it/str_dataview_station/1310',
  ])
  assert.deepEqual(texts(doc, '.stz .near__m'), ['3 km · 375 m', 'meno di 1 km · 340 m'])
  assert.deepEqual(texts(doc, '.stz .near__d'), ['125 m più in basso', '160 m più in basso'])
  assert.deepEqual(texts(doc, '.stz__src'), ['Dati misurati: Centro Funzionale della Valle d’Aosta'])
})

test('a route with no recorded height lists its stations without saying above or below', () => {
  const doc = withStations(STATIONS, null)
  assert.deepEqual(texts(doc, '.stz .near__d'), ['', ''])
})

test('no station nearby, no fold; a station of an unknown network is left out', () => {
  assert.equal(countOf(withStations([]), '.stz'), 0)
  assert.equal(countOf(withStations([{ ...STATIONS[0]!, network: 'altrove' }]), '.stz'), 0)
})
