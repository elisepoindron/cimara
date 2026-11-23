import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { factsLine, iconSprite, HISTOGRAM_WIDTH } from '../../src/render/facts-line.ts'
import { render } from '../../src/render/html.ts'
import type { GradeAxis, RowCell, RowSlot } from '../../src/domain/row-facts.ts'
import type { Aspect } from '../../src/domain/quantity.ts'

const dom = (slots: readonly RowSlot[], axis: GradeAxis | null = null, aligned = true) =>
  parseHTML(`<div>${render(factsLine(slots, axis, { aligned }))}</div>`).document

const fact = (icon: 'vie' | 'esp' | 'avv' | 'grado' | 'dplus', label: string, text: string,
              aspect: Aspect | null = null): RowCell =>
  ({ kind: 'fact', icon, label, text, aspect })
const crag = (...counts: [string, number, number][]): RowCell => ({
  kind: 'histogram', scale: 'sport', each: 'via', many: 'vie',
  counts: counts.map(([grade, ordinal, n]) => ({ grade, ordinal, n })),
  total: counts.reduce((s, [, , n]) => s + n, 0),
})
// The ordinals in a cell are the scale's own; the axis draws chart steps, a plus with its letter.
const AXIS: GradeAxis = { scale: 'sport', grades: ['6a', '6b', '6c', '7a', '7b', '7c'] }

test('every icon names itself, for a tooltip and for a screen reader', () => {
  const doc = dom([fact('vie', 'Vie', '22'), fact('avv', 'Avvicinamento', '20 min'), { kind: 'distance', km: 63.4 }])
  const icons = [...doc.querySelectorAll('svg.ic')]

  assert.deepEqual(icons.map(i => i.getAttribute('aria-label')), ['Vie', 'Avvicinamento', 'Distanza'])
  assert.ok(icons.every(i => i.getAttribute('role') === 'img'))
  assert.deepEqual(icons.map(i => i.querySelector('title')!.textContent), ['Vie', 'Avvicinamento', 'Distanza'])
  assert.deepEqual(icons.map(i => i.querySelector('use')!.getAttribute('href')), ['#i-vie', '#i-avv', '#i-km'])
  assert.deepEqual([...doc.querySelectorAll('dd')].map(d => d.textContent), ['22', '20 min', '63 km'])
})

test('the compass points the way the face looks', () => {
  const rotation = (aspect: Aspect) =>
    dom([fact('esp', 'Esposizione', 'x', aspect)]).querySelector('svg.ic path')!.getAttribute('transform')
  assert.equal(rotation('N'), 'rotate(0 12 12)')
  assert.equal(rotation('SE'), 'rotate(135 12 12)')
  assert.equal(rotation('NO'), 'rotate(315 12 12)')
})

test('the histogram is always the same width, one bar per step the crag has', () => {
  const doc = dom([crag(['6a', 7, 2], ['7a', 13, 1], ['7a+', 14, 4], ['7c', 17, 1])], AXIS)
  const svg = doc.querySelector('svg.gh')!

  assert.equal(svg.getAttribute('width'), String(HISTOGRAM_WIDTH))
  assert.equal(doc.querySelectorAll('.gh rect').length, 3)
  assert.equal(svg.getAttribute('aria-label'), 'Gradi: 8 vie dal 6a al 7c')
  assert.deepEqual([...doc.querySelectorAll('.gh rect title')].map(t => t.textContent),
    ['6a: 2 vie', '7a: 5 vie', '7c: 1 via'], '7a and 7a+ are one bar')
  assert.deepEqual([...doc.querySelectorAll('.gh text')].map(t => t.textContent), ['6a', '7a'],
    'ticked at every "a" grade on the axis')
})

test('bars sit where their grades are on the shared axis, not packed to the left', () => {
  const doc = dom([crag(['7c', 17, 1])], AXIS)
  const x = Number(doc.querySelector('.gh rect')!.getAttribute('x'))
  assert.equal(x, 113.3, '7c is the sixth and last step of 6a–7c, at 5 × (134 + 2) / 6')
})

test('one grade on the axis draws one full-width bar', () => {
  const doc = dom([crag(['6a', 7, 3])], { scale: 'sport', grades: ['6a'] })
  const rect = doc.querySelector('.gh rect')!
  assert.equal(rect.getAttribute('x'), '0')
  assert.equal(rect.getAttribute('width'), String(HISTOGRAM_WIDTH))
  assert.equal(rect.getAttribute('height'), '20')
})

test('an empty slot keeps its column in an aligned list', () => {
  const doc = dom([null, fact('vie', 'Vie', '3'), null, fact('avv', 'Avvicinamento', '15 min')])
  const cells = [...doc.querySelectorAll('.r__f > div')]
  assert.equal(cells.length, 4, 'app.css places facts by position, so the gap has to be there')
  assert.equal(cells[0]!.childElementCount, 0)
  assert.equal(cells[1]!.querySelector('dd')!.textContent, '3')
})

test('an unaligned line leaves an empty slot out, so its gaps stay even', () => {
  const doc = dom([null, fact('vie', 'Vie', '3'), null, fact('avv', 'Avvicinamento', '15 min')], null, false)
  assert.equal(doc.querySelectorAll('.r__f > div').length, 2)
})

test('a line with nothing to show is not drawn at all', () => {
  assert.equal(dom([null, null]).querySelectorAll('.r__f').length, 0)
  assert.equal(dom([]).querySelectorAll('.r__f').length, 0)
})

test('a value is text, not markup', () => {
  const doc = dom([fact('vie', 'Vie', '<b>22</b>')])
  assert.equal(doc.querySelectorAll('dd b').length, 0)
  assert.equal(doc.querySelector('dd')!.textContent, '<b>22</b>')
})

test('the sprite declares each icon once', () => {
  const doc = parseHTML(`<div>${render(iconSprite())}</div>`).document
  assert.deepEqual([...doc.querySelectorAll('symbol')].map(s => s.getAttribute('id')),
    ['i-vie', 'i-esp', 'i-avv', 'i-grado', 'i-dplus', 'i-km'])
  assert.equal(doc.querySelector('svg.icons')!.getAttribute('aria-hidden'), 'true')
})

test('each histogram bar carries its grade\'s band', () => {
  const doc = dom([crag(['6a', 7, 2], ['6c+', 12, 1], ['7c', 17, 1])], AXIS)
  assert.deepEqual([...doc.querySelectorAll('.gh rect')].map(r => r.getAttribute('data-grade')),
    ['6', '6', '7'])
})

test('two grades share one difficulty icon, each named and in its colour', () => {
  const doc = dom([{ kind: 'grades', label: 'Difficoltà',
    grades: [{ it: 'obbligatoria', grade: '6a+' }, { it: 'max', grade: '6c' }] }])
  assert.equal(doc.querySelectorAll('.r__f use').length, 1)
  assert.equal(doc.querySelector('.r__f use')!.getAttribute('href'), '#i-grado')
  const dd = doc.querySelector('dd.r__g')!
  assert.deepEqual([...dd.querySelectorAll('small')].map(s => s.textContent), ['obbligatoria', 'max'])
  assert.deepEqual([...dd.querySelectorAll('em')].map(e => [e.textContent, e.getAttribute('data-grade')]),
    [['6a+', '6'], ['6c', '6']])
})
