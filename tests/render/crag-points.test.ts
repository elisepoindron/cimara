import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { html, render } from '../../src/render/html.ts'
import { alpinePoints, cragPoints, trackPoints } from '../../src/render/crag-points.ts'
import type { TrackPoint } from '../../src/domain/track.ts'
import type { ItineraryRow } from '../../src/db/itinerary.ts'
import type { Trail } from '../../src/domain/trail.ts'

const balma = (over: Partial<ItineraryRow> = {}): ItineraryRow => ({
  id: 'balma', activity: 'falesia', placeId: '3', name: 'Balma Scura',
  lat: 45.06, lon: 7.15, parkingLat: 45.0587, parkingLon: 7.1443, aspect: 'S', altMax: 780,
  facts: {}, sections: {}, ...over,
})

const dom = (it: ItineraryRow, approach: string | null = '20 min') => parseHTML(
  `<!doctype html><body>${render(cragPoints(it, approach, { sectionId: 'parcheggio', label: 'Parcheggio' }))}</body>`,
).document

test('two rows, parking then crag, each a shape, a name, a position and a link', () => {
  const doc = dom(balma())
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dt')].map(n => n.textContent!.trim()), ['Parcheggio', 'Falesia'])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['45.0587, 7.1443', '45.06, 7.15'])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd a')].map(a => a.getAttribute('href')), [
    'https://www.google.com/maps/dir/?api=1&destination=45.0587,7.1443',
    'https://www.google.com/maps/search/?api=1&query=45.06,7.15',
  ])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd a')].map(a => a.textContent), ['Indicazioni →', 'Mappa →'])
  assert.equal(doc.querySelectorAll('.pk__p .pk__sq').length, 1, 'the parking is a square')
  assert.equal(doc.querySelectorAll('.pk__f .pk__tri').length, 1, 'the crag is a triangle')
})

test('the map carries both points and the approach time', () => {
  const data = JSON.parse(dom(balma()).querySelector('#map-data')!.textContent!)
  assert.deepEqual(data, {
    parking: { lat: 45.0587, lon: 7.1443 }, crag: { lat: 45.06, lon: 7.15 }, approach: '20 min',
    big: { title: 'Balma Scura · avvicinamento', summary: '20 min' },
  })
})

const walkIn: Trail = { coords: [[7.1443, 45.0587], [7.15, 45.0587], [7.15, 45.06]], lengthM: 1240, ascentM: 180 }
const withTrail = (it: ItineraryRow, trail: Trail = walkIn, approach: string | null = '20 min') => parseHTML(
  `<!doctype html><body>${render(cragPoints(it, approach, { sectionId: 'parcheggio', label: 'Parcheggio' }, trail))}</body>`,
).document
const figures = (doc: Document) =>
  [...doc.querySelectorAll('.pk__fig div')].map(d => `${d.querySelector('dt')!.textContent} ${d.querySelector('dd')!.textContent}`)

test('a found trail shows its length, climb and the page’s own time, then says it is a suggestion', () => {
  const doc = withTrail(balma())
  assert.deepEqual(figures(doc), ['Lunghezza 1,2 km', 'Dislivello +180 m', 'Tempo 20 min'])
  assert.equal(doc.querySelector('.pk__src')!.textContent, 'Sentiero suggerito da OpenStreetMap · da verificare sul posto')
})

test('with no time on the page, the time is worked out from the trail and said to be an estimate', () => {
  const doc = withTrail(balma(), walkIn, null)
  // 1,24 km at 4 km/h is 0,31 h; 180 m at 300 m/h is 0,6 h: 0,6 + 0,155 = 45 min
  assert.deepEqual(figures(doc), ['Lunghezza 1,2 km', 'Dislivello +180 m', 'Tempo ~45 min'])
  assert.match(doc.querySelector('.pk__src')!.textContent!, /tempo stimato/)
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal(data.approach, '~45 min', 'the map’s label carries the estimate too')
  assert.equal(data.big.summary, '1,2 km · +180 m · ~45 min')
})

test('a router with no climb figure leaves the climb out rather than saying zero', () => {
  assert.deepEqual(figures(withTrail(balma(), { ...walkIn, ascentM: null })), ['Lunghezza 1,2 km', 'Tempo 20 min'])
})

test('a found trail travels to the map, with where its label sits along it', () => {
  const data = JSON.parse(withTrail(balma()).querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.trail.coords, walkIn.coords)
  assert.equal(data.trail.labelAt.length, 2)
  assert.equal(data.trail.labelAt[1], 45.0587, 'halfway by distance walked lies on the long eastward leg')
})

test('no trail: no note, and the map draws its straight line', () => {
  const doc = dom(balma())
  assert.equal(doc.querySelectorAll('.pk__src').length, 0)
  assert.equal('trail' in JSON.parse(doc.querySelector('#map-data')!.textContent!), false)
})

test('a trail is not drawn when one of its two points is missing', () => {
  const doc = withTrail(balma({ parkingLat: null, parkingLon: null }))
  assert.equal(doc.querySelectorAll('.pk__src').length, 0)
  assert.equal('trail' in JSON.parse(doc.querySelector('#map-data')!.textContent!), false)
})

test('a point nobody recorded is a dash, and the map draws the other alone', () => {
  const doc = dom(balma({ parkingLat: null, parkingLon: null }))
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['—', '45.06, 7.15'])
  assert.equal(doc.querySelectorAll('.pk__p dd a').length, 0)
  assert.equal(JSON.parse(doc.querySelector('#map-data')!.textContent!).parking, null)
})

test('no point at all: both rows dash, and there is no map', () => {
  const doc = dom(balma({ lat: null, lon: null, parkingLat: null, parkingLon: null }))
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['—', '—'])
  assert.equal(doc.querySelectorAll('#map').length, 0)
})

const cresta = (over: Partial<ItineraryRow> = {}): ItineraryRow => ({
  id: 'cresta', activity: 'alpinismo', placeId: '1', name: 'Monviso, Cresta Est',
  lat: 44.6673, lon: 7.0913, parkingLat: 44.69938, parkingLon: 7.15609, aspect: 'E', altMax: 3841,
  facts: {}, sections: {}, ...over,
})

const alpine = (it: ItineraryRow) => {
  const panel = alpinePoints(it, { sectionId: 'parcheggio', label: 'Parcheggio' })
  return parseHTML(`<!doctype html><body>${panel ? render(panel) : ''}</body>`).document
}

test('an alpine route names its two points by shape too: a P square, and a triangle for the summit', () => {
  const doc = alpine(cresta())
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dt')].map(n => n.textContent!.trim()), ['Parcheggio', 'Vetta'])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['44.69938, 7.15609', '44.6673, 7.0913'])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd a')].map(a => a.getAttribute('href')), [
    'https://www.google.com/maps/dir/?api=1&destination=44.69938,7.15609',
    'https://www.google.com/maps/search/?api=1&query=44.6673,7.0913',
  ])
  assert.equal(doc.querySelectorAll('.pk__p .pk__sq').length, 1, 'the parking is a square')
  assert.equal(doc.querySelectorAll('.pk__v .pk__tri').length, 1, 'the summit is a triangle')
  assert.equal(doc.querySelector('script[type="module"]')!.getAttribute('src'), '/parking-map.js')
})

test('an alpine route with no summit point dashes that row, and its map draws the parking alone', () => {
  const doc = alpine(cresta({ lat: null, lon: null }))
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['44.69938, 7.15609', '—'])
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal('itineraryLat' in data, false)
})

test('an alpine route with no parking keeps its panel, the road alone, without points or map', () => {
  const out = render(alpinePoints(cresta({ parkingLat: null, parkingLon: null }),
    { sectionId: 'parcheggio', label: 'Come arrivare' }, [], html`<dl class="pk__road"></dl>`))
  assert.match(out, /<h2>Come arrivare<\/h2>/)
  assert.match(out, /pk__road/)
  assert.doesNotMatch(out, /pk__pts|pk__map/)
})

test('a multi-pitch names its own point Attacco, and a dash where only the parking is recorded', () => {
  const point = { it: 'Attacco', of: 'dell’attacco' }
  const only = balma({ lat: 45.05, lon: 7.14, parkingLat: 45.05, parkingLon: 7.14 })
  const doc = parseHTML(`<!doctype html><body>${render(cragPoints(only, null,
    { sectionId: 'parcheggio', label: 'Come arrivare', point }))}</body>`).document
  const rows = [...doc.querySelectorAll('.pk__pts > div')].map(d => d.textContent!.trim())
  assert.match(rows[0]!, /^Parcheggio45\.05, 7\.14/)
  assert.equal(rows[1], 'Attacco—')
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal(data.crag, null, 'the map draws the parking alone')
  assert.match(doc.querySelector('#map')!.getAttribute('aria-label')!, /parcheggio e dell’attacco/)
})

const hike: TrackPoint[] = [[7.3527, 45.12, 380], [7.353, 45.13, 900], [7.352, 45.1396, 1498], [7.351, 45.135, 1300]]
const trackDom = () => parseHTML(
  `<!doctype html><body>${render(trackPoints(hike, 'Sella (Rocca)', { sectionId: 'parcheggio', label: 'Come arrivare' }))}</body>`,
).document

test('a hike with a track names where it starts and where it goes highest, square and triangle', () => {
  const doc = trackDom()
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dt')].map(n => n.textContent!.trim()), ['Partenza', 'Meta'])
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['45.12, 7.3527', '45.1396, 7.352'])
  assert.equal(doc.querySelectorAll('.pk__p .pk__sq').length, 1)
  assert.equal(doc.querySelectorAll('.pk__v .pk__tri').length, 1)
})

test('a track with a recorded parking puts the square at the parking, and still draws the track', () => {
  const doc = parseHTML(`<!doctype html><body>${render(trackPoints(hike, 'Sella (Rocca)',
    { sectionId: 'parcheggio', label: 'Come arrivare' }, [], html``, { lat: 45.119, lon: 7.3525 }))}</body>`).document
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dt')].map(n => n.textContent!.trim()), ['Parcheggio', 'Meta'])
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.parking, { lat: 45.119, lon: 7.3525 })
  assert.equal(data.trail.coords.length, 4)
})

test('a track with no heights takes as its goal the point farthest from the parking, not its last', () => {
  // A line walked from its far end, as OpenStreetMap draws it: the last point is by the car.
  const line: TrackPoint[] = [[7.0, 45.2, null], [7.05, 45.15, null], [7.1, 45.1, null]]
  const doc = parseHTML(`<!doctype html><body>${render(trackPoints(line, 'Giro',
    { sectionId: 'parcheggio', label: 'Come arrivare' }, [], html``, { lat: 45.101, lon: 7.101 }))}</body>`).document
  assert.deepEqual([...doc.querySelectorAll('.pk__pts dd span')].map(n => n.textContent), ['45.101, 7.101', '45.2, 7'])
})

test("a hike's map draws the track whole, solid, with no dotted ends and no time guessed", () => {
  const doc = trackDom()
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.parking, { lat: 45.12, lon: 7.3527 })
  assert.deepEqual(data.crag, { lat: 45.1396, lon: 7.352 })
  assert.equal(data.trail.coords.length, 4)
  assert.equal(data.goal, 'v')
  assert.equal(data.ends, false)
  assert.equal(data.approach, null)
  assert.equal(data.big.title, 'Sella (Rocca) · traccia')
  assert.deepEqual([...doc.querySelectorAll('.pk__fig dt')].map(n => n.textContent), ['Lunghezza', 'Dislivello'])
  assert.match(doc.querySelector('.pk__src')!.textContent!, /Traccia GPS/)
  assert.doesNotMatch(doc.querySelector('.pk__src')!.textContent!, /stimato/)
})
