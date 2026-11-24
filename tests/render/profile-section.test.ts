import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { percorsoPosition, profileSection, tone, PERCORSO_YELLOW } from '../../src/render/profile-section.ts'
import { render } from '../../src/render/html.ts'
import type { ProfileSample } from '../../src/domain/profile.ts'

const dom = (h: string) => parseHTML(`<html><body>${h}</body></html>`).document
const samples: ProfileSample[] = Array.from({ length: 41 }, (_, i) => ({ d: i * 140, e: 380 + i * 28, s: 10 + i % 30, g: 20 }))

const draw = (over: Partial<Parameters<typeof profileSection>[0]> = {}) => dom(render(profileSection({
  sectionId: 'profilo', label: 'Profilo', samples, climbM: 1130,
  start: { name: 'Borgo', heightM: 380 }, topM: 1508, ...over,
})!))

test('the header is the length along the line and the sheet’s own climb', () => {
  assert.equal(draw().querySelector('.pf__head')!.textContent, '5,6 km · 1130 m di dislivello')
  assert.equal(draw({ climbM: null }).querySelector('.pf__head')!.textContent, '5,6 km · 1120 m di dislivello',
    'without the sheet’s figure, the profile’s own')
})

test('the ends are named with the sheet’s heights, not the terrain’s', () => {
  assert.deepEqual([...draw().querySelectorAll('.pf__name')].map(n => n.textContent), ['Borgo 380 m', '1508 m'])
  assert.deepEqual([...draw({ start: { name: null, heightM: null }, topM: null }).querySelectorAll('.pf__name')].map(n => n.textContent),
    ['380 m', '1500 m'], 'where the sheet says nothing, the profile’s ends')
})

test('Percorso first, and shown; the switch waits for its script', () => {
  const doc = draw()
  const box = doc.querySelector('.pf')!
  assert.equal(box.getAttribute('data-k'), 'g')
  const sw = doc.querySelector('.pf__sw')!
  assert.equal(sw.hasAttribute('hidden'), true)
  assert.deepEqual([...sw.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]),
    [['Percorso', 'true'], ['Pendio', 'false']])
  assert.equal(doc.querySelectorAll('svg path.pf__lay').length, 2, 'both measures drawn, one shown')
  assert.equal(JSON.parse(box.getAttribute('data-samples')!).length, samples.length, 'the reading has every sample')
})

test('the key reads 25% where Pendio reads 30°', () => {
  const ticks = [...draw().querySelectorAll('.pf__ticks span')].map(s => [s.querySelector('b')!.textContent, s.querySelector('em')!.textContent])
  assert.deepEqual(ticks, [['0°', '0%'], ['15°', '13%'], ['30°', '25%'], ['35°', '35%'], ['40°', '45%'], ['45°', '55%']])
})

test('the source names the terrain it was read from', () => {
  const a = draw().querySelector('.pf__src a')!
  assert.equal(a.textContent, 'Terrain Tiles')
  assert.match(a.getAttribute('href')!, /tilezen\/joerd/)
})

test('one ramp for both: greys below yellow, yellow at 30° and at 25%', () => {
  assert.equal(tone(30), '#f2cf1b')
  assert.equal(tone(29), '#93a3ad')
  assert.equal(percorsoPosition(PERCORSO_YELLOW), 30)
  assert.equal(percorsoPosition(-PERCORSO_YELLOW), 30, 'a steep way down is as steep')
  assert.equal(percorsoPosition(55), 45)
  assert.ok(percorsoPosition(24) < 30)
})

test('no line, no profile', () => {
  assert.equal(profileSection({ sectionId: 'profilo', label: 'Profilo', samples: samples.slice(0, 1) }), null)
})
