import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { aroundPins, nearbySection, recency } from '../../src/render/nearby-section.ts'
import type { NearbyRoute } from '../../src/db/itinerary.ts'

const NOW = new Date('2026-11-16T10:00:00.000Z')
const route = (o: Partial<NearbyRoute> = {}): NearbyRoute => ({
  id: 'r1', name: 'Muro dei Ciliegi', lat: 45.06, lon: 7.17, distanceM: 2100, aspect: 'S', altMax: 640,
  recent: 3, lastReportAt: '2026-11-15', ...o })
const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document
const texts = (doc: Document, sel: string) => [...doc.querySelectorAll(sel)].map(n => n.textContent!.trim())
const OPTS = { sectionId: 'vicine', label: 'Falesie vicine', now: NOW }

test('each row names the route, where it is, and how recently it was reported', () => {
  const doc = dom(render(nearbySection([route()], OPTS)!))
  assert.deepEqual(texts(doc, 'h2'), ['Falesie vicine'])
  assert.deepEqual(texts(doc, '.near__n'), ['Muro dei Ciliegi'])
  assert.deepEqual(texts(doc, '.near__m'), ['2 km · sud · 640 m'])
  assert.deepEqual(texts(doc, '.near__d'), ['3 relazioni, l’ultima ieri'])
  assert.equal(doc.querySelector('.near a')!.getAttribute('href'), '/itinerario/r1')
})

test('recency reads four ways', () => {
  assert.equal(recency(route({ recent: 1, lastReportAt: '2026-11-14' }), NOW), '1 relazione, due giorni fa')
  assert.equal(recency(route({ recent: 0, lastReportAt: '2026-08-10' }), NOW), 'nessuna da tre mesi')
  assert.equal(recency(route({ recent: 0, lastReportAt: null }), NOW), 'nessuna relazione')
  assert.equal(recency(route(), NOW), '3 relazioni, l’ultima ieri')
})

test('three are shown, nearest first as given', () => {
  const doc = dom(render(nearbySection([1, 2, 3, 4].map(i => route({ id: `r${i}`, name: `R${i}` })), OPTS)!))
  assert.deepEqual(texts(doc, '.near__n'), ['R1', 'R2', 'R3'])
})

test('nothing nearby, no section', () => {
  assert.equal(nearbySection([], OPTS), null)
})

test('a route without aspect or altitude says only its distance', () => {
  const doc = dom(render(nearbySection([route({ aspect: null, altMax: null, distanceM: 400 })], OPTS)!))
  assert.deepEqual(texts(doc, '.near__m'), ['meno di 1 km'])
})

test('the map’s pins are the same neighbours, each card saying how far and how recently — never a verdict', () => {
  const [pin] = aroundPins([route()], 'falesia', NOW)
  assert.deepEqual(pin, {
    id: 'r1', name: 'Muro dei Ciliegi', lat: 45.06, lon: 7.17, activity: 'falesia',
    recap: { kind: 'Falesia', where: '', facts: [
      { label: 'Distanza', text: '2 km' },
      { label: 'Relazioni', text: '3 relazioni, l’ultima ieri' },
    ] },
  })
})

test('a pin for a route nobody has reported says so, as its row does', () => {
  const [pin] = aroundPins([route({ distanceM: 300, recent: 0, lastReportAt: null })], 'falesia', NOW)
  assert.deepEqual(pin!.recap!.facts.map(f => f.text), ['meno di 1 km', 'nessuna relazione'])
})
