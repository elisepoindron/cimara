import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { gradeHistogram } from '../../src/render/histogram.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import type { Part } from '../../src/domain/facts.ts'

const dom = (m: string) => parseHTML(`<!doctype html><body>${m}</body>`).document
const via = (n: number, grado: string): Part =>
  ({ id: `v${n}`, group: null, position: n, fields: { nome: `Via ${n}`, grado, lunghezza: 20 } })

const falesia = activityOf('falesia')

const FIVE_A_TO_8C = ['5a', '5b', '5c', '6a', '6b', '6c', '7a', '7b', '7c', '8a', '8b', '8c']
const labels = (doc: Document) => [...doc.querySelectorAll('g.bar text.g')].map(n => n.textContent)
const drawn = (doc: Document) => Object.fromEntries([...doc.querySelectorAll('g.bar')]
  .filter(g => g.querySelectorAll('path').length > 0)
  .map(g => [g.querySelector('text.g')!.textContent, g.querySelector('text.n')!.textContent]))

test('every crag is drawn on the same columns, 5a to 8c, the empty ones labelled with no bar', () => {
  const doc = dom(render(gradeHistogram(falesia,
    [via(1, '6a'), via(2, '6a'), via(3, '7a')], 'grado')!))

  assert.deepEqual(labels(doc), FIVE_A_TO_8C)
  assert.deepEqual(drawn(doc), { '6a': '2', '7a': '1' })
  assert.equal(doc.querySelectorAll('g.bar path').length, 2, 'an empty column draws no bar')
})

test('a grade outside 5a to 8c adds its column at that end', () => {
  const doc = dom(render(gradeHistogram(falesia, [via(1, '4c'), via(2, '9a')], 'grado')!))
  assert.deepEqual(labels(doc), ['4c', ...FIVE_A_TO_8C, '9a'])
})

test('a plus grade is counted with its letter', () => {
  const doc = dom(render(gradeHistogram(falesia,
    [via(1, '6a'), via(2, '6a+'), via(3, '6b+')], 'grado')!))

  assert.deepEqual(drawn(doc), { '6a': '2', '6b': '1' })
})

test('a full bar stands for ten vie, so one via per grade stays short', () => {
  const doc = dom(render(gradeHistogram(falesia, [via(1, '6a'), via(2, '6b'), via(3, '6c')], 'grado')!))
  const tops = [...doc.querySelectorAll('g.bar path')]
    .map(p => Number(/ L[\d.]+,([\d.]+)/.exec(p.getAttribute('d')!)![1]))
  // One via is a tenth of the 118 a full bar rises, so its top (less the corner) sits at 158 - 11.8.
  assert.deepEqual(tops, [150.2, 150.2, 150.2])
})

test('a crag with more than ten vie in a grade is drawn to its own tallest', () => {
  const parts = Array.from({ length: 12 }, (_, i) => via(i + 1, '7a'))
  const doc = dom(render(gradeHistogram(falesia, parts, 'grado')!))
  assert.match(doc.querySelector('g.bar path')!.getAttribute('d')!, / L[\d.]+,44\.0 /,
    'the tallest reaches y=40 plus its corner radius')
})

test('the geometry matches crag.html exactly', () => {
  // The mockup's own eleven grades, folded into six of the twelve columns, the tallest (7a) holding seven vie.
  const parts: Part[] = []
  const counts: Record<string, number> = {
    '6a': 2, '6a+': 2, '6b': 2, '6b+': 2, '6c': 1, '6c+': 2,
    '7a': 2, '7a+': 5, '7b': 2, '7b+': 1, '7c': 1,
  }
  let n = 0
  for (const [grade, k] of Object.entries(counts)) {
    for (let i = 0; i < k; i++) parts.push(via(++n, grade))
  }

  const doc = dom(render(gradeHistogram(falesia, parts, 'grado')!))
  const svg = doc.querySelector('svg')!
  assert.equal(svg.getAttribute('viewBox'), '0 0 640 200')
  assert.equal(doc.querySelectorAll('g.bar').length, 12)

  const bars = [...doc.querySelectorAll('g.bar path')]
  assert.equal(bars.length, 6)
  assert.equal(bars[0]!.getAttribute('d'),
    'M162.0,158 L162.0,114.8 Q162.0,110.8 166.0,110.8 L204.0,110.8 Q208.0,110.8 208.0,114.8 L208.0,158 Z')
  assert.equal(bars[3]!.getAttribute('d')?.startsWith('M324.0,158 L324.0,79.4'), true,
    'seven vie rise seven tenths of a full bar')

  assert.equal(doc.querySelector('line.axis')?.getAttribute('y1'), '158')
})

test('the title of each bar reads as Italian, singular included', () => {
  const doc = dom(render(gradeHistogram(falesia,
    [via(1, '6a'), via(2, '6a'), via(3, '7a')], 'grado')!))

  const titles = [...doc.querySelectorAll('g.bar title')].map(n => n.textContent)
  assert.deepEqual(titles.slice(3, 7), ['6a: 2 vie su 3', '6b: 0 vie su 3', '6c: 0 vie su 3', '7a: 1 via su 3'])
})

test('the whole chart is described for a screen reader', () => {
  const doc = dom(render(gradeHistogram(falesia, [via(1, '6a'), via(2, '7a')], 'grado')!))
  const svg = doc.querySelector('svg')!

  assert.equal(svg.getAttribute('role'), 'img')
  assert.equal(svg.getAttribute('aria-label'), 'Ripartizione dei gradi: 6a 1 via, 7a 1 via',
    'the empty columns are not read aloud')
})

test('no parts, no chart', () => {
  assert.equal(gradeHistogram(falesia, [], 'grado'), null)
})

test('a part whose grade fails to parse is dropped from the bars and from the "su N" total alike', () => {
  const bad: Part = { id: 'bad', group: null, position: 4,
                       fields: { nome: 'Via rotta', grado: 'non-un-grado', lunghezza: 20 } }
  const doc = dom(render(gradeHistogram(falesia, [via(1, '6a'), via(2, '6a'), via(3, '7a'), bad], 'grado')!))

  const titles = [...doc.querySelectorAll('g.bar title')].map(n => n.textContent)
  assert.deepEqual(titles.filter(t => !t!.includes(': 0 ')), ['6a: 2 vie su 3', '7a: 1 via su 3'],
    'the total is the three parsed grades, not the four parts including the bad one')
})

test('each bar carries its grade\'s band, the number alone', () => {
  const doc = dom(render(gradeHistogram(falesia,
    [via(1, '5c'), via(2, '6a'), via(3, '6c+'), via(4, '7a')], 'grado')!))

  assert.deepEqual([...doc.querySelectorAll('g.bar')].map(g => g.getAttribute('data-grade')),
    ['5', '5', '5', '6', '6', '6', '7', '7', '7', '8', '8', '8'])
})

test('a 9 brings the gradient its count is written in; a crag without one does not', () => {
  const withNine = dom(render(gradeHistogram(falesia, [via(1, '8c+'), via(2, '9a')], 'grado')!))
  assert.equal(withNine.querySelectorAll('linearGradient#grade-nine-ink').length, 1)
  assert.equal(withNine.querySelector('g.bar[data-grade="9"]')?.getAttribute('data-grade'), '9')

  const without = dom(render(gradeHistogram(falesia, [via(1, '6a'), via(2, '7a')], 'grado')!))
  assert.equal(without.querySelectorAll('linearGradient').length, 0)
})

test('the tallest step is marked as the peak, every tie included, and an empty crag column never is', () => {
  const doc = dom(render(gradeHistogram(falesia,
    [via(1, '6a'), via(2, '6a'), via(3, '7a'), via(4, '7a'), via(5, '5c')], 'grado')!))
  const peaks = [...doc.querySelectorAll('g.bar.peak text.g')].map(n => n.textContent)
  assert.deepEqual(peaks, ['6a', '7a'])
})
