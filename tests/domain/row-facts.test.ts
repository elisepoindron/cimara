import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityOf } from '../../src/domain/activities/index.ts'
import { rowCellsOf, axisOf, barsOn, type RowCell } from '../../src/domain/row-facts.ts'
import type { Part } from '../../src/domain/facts.ts'

const falesia = activityOf('falesia')
const alpinismo = activityOf('alpinismo')

const vie = (...grades: string[]): Part[] => grades.map((grado, i) => ({
  id: `p${i}`, group: null, position: i, fields: { nome: `via ${i}`, grado, lunghezza: 20 },
}))
const CRAG = { esposizione: 'S', quota_base: 780, avvicinamento: 20 }
const ROUTE = { difficolta: 'AD', dislivello: 2000, partenza: 2020, vetta: 3841, esposizione: 'SE', giorni: 2 }

type Of<K extends RowCell['kind']> = Extract<RowCell, { kind: K }>
const facts = (slots: readonly (RowCell | null)[]) =>
  slots.map(c => (c?.kind === 'fact' ? [c.icon, c.label, c.text] : c?.kind ?? null))

test('a crag’s row: where its vie sit, how many, which way it faces, how long the walk', () => {
  const slots = rowCellsOf(falesia, CRAG, vie('6a', '6a', '7a+'), null)

  assert.deepEqual(facts(slots), [
    'histogram', ['vie', 'Vie', '3'], ['esp', 'Esposizione', 'Sud'], ['avv', 'Avvicinamento', '20 min'],
  ])
  const h = slots[0] as Of<'histogram'>
  assert.deepEqual(h.counts.map(c => [c.grade, c.n]), [['6a', 2], ['7a+', 1]])
  assert.equal(h.total, 3)
  assert.equal(h.scale, 'sport')
  assert.deepEqual([h.each, h.many], ['via', 'vie'])
  assert.equal((slots[2] as Of<'fact'>).aspect, 'S', 'the compass needs the value, not its label')
})

test('a route’s row: its grade, its climb, its aspect, and how far it is', () => {
  const slots = rowCellsOf(alpinismo, ROUTE, [], 64.6)

  assert.deepEqual(facts(slots), [
    ['grado', 'Difficoltà', 'AD'], ['dplus', 'Dislivello', '2000 m'], ['esp', 'Esposizione', 'Sud-Est'], 'distance',
  ])
  assert.equal((slots[3] as Of<'distance'>).km, 64.6)
})

test('with no place named there is no distance, and its slot stays', () => {
  const slots = rowCellsOf(alpinismo, ROUTE, [], null)
  assert.equal(slots.length, 4)
  assert.equal(slots[3], null)
})

test('a value that cannot be read empties its slot and throws nothing', () => {
  const { difficolta: _, ...ungraded } = ROUTE
  assert.equal(rowCellsOf(alpinismo, ungraded, [], null)[0], null, 'an optional fact nobody recorded')
  assert.equal(rowCellsOf(alpinismo, { ...ROUTE, esposizione: 'Sud' }, [], null)[2], null, 'not an aspect')
  assert.equal(rowCellsOf(falesia, { ...CRAG, avvicinamento: undefined }, vie('6a'), null)[3], null,
    'a required fact missing is the boot check’s to report, not Find’s to crash on')
  assert.equal(rowCellsOf(falesia, CRAG, [], null)[0], null, 'no vie, no histogram')
  assert.equal(rowCellsOf(falesia, CRAG, vie('6z'), null)[0], null, 'no readable grade, no histogram')
})

test('an activity with no row has an empty facts line', () => {
  assert.deepEqual(rowCellsOf({ ...falesia, row: undefined }, CRAG, vie('6a'), null), [])
})

test('the axis spans every crag in the list, with the grades between, a plus counted with its letter', () => {
  const a = rowCellsOf(falesia, CRAG, vie('6a+', '6b+'), null)
  const b = rowCellsOf(falesia, CRAG, vie('6b', '7a+'), null)

  const axis = axisOf([a, b])!
  assert.deepEqual(axis.grades, ['6a', '6b', '6c', '7a'])
  assert.equal(axis.scale, 'sport')
})

test('a row draws its grades folded onto the axis, a 6a and a 6a+ in one bar', () => {
  const cell = rowCellsOf(falesia, CRAG, vie('6a', '6a+', '6c+'), null)[0]!
  assert.equal(cell.kind, 'histogram')
  const axis = { scale: 'sport' as const, grades: ['5c', '6a', '6b', '6c'] }
  assert.deepEqual(barsOn(cell as Extract<typeof cell, { kind: 'histogram' }>, axis), [
    { grade: '6a', at: 1, n: 2 },
    { grade: '6c', at: 3, n: 1 },
  ])
  assert.deepEqual((cell as Extract<typeof cell, { kind: 'histogram' }>).counts.map(c => c.grade),
    ['6a', '6a+', '6c+'], 'the cell keeps the grades as written')
})

test('a list with no histogram has no axis', () => {
  assert.equal(axisOf([rowCellsOf(alpinismo, ROUTE, [], 60)]), null)
  assert.equal(axisOf([]), null)
})

const multipitch = activityOf('multipitch')

test('a multi-pitch’s row: both grades in one cell, the pitches, the length, the walk-in', () => {
  const slots = rowCellsOf(multipitch,
    { grado_max: '6c', grado_obbligatorio: '6a+', tiri: 6, sviluppo: 200, avvicinamento: 60 }, [], null)
  assert.deepEqual(facts(slots), [
    'grades', ['vie', 'Tiri', '6'], ['dplus', 'Sviluppo', '200 m'], ['avv', 'Avvicinamento', '60 min'],
  ])
  assert.deepEqual((slots[0] as Of<'grades'>).grades,
    [{ it: 'obbligatoria', grade: '6a+' }, { it: 'max', grade: '6c' }], 'the easier first, each named')
})

test('one grade alone is still named; the same grade twice is said once', () => {
  const one = rowCellsOf(multipitch, { grado_obbligatorio: '3' }, [], null)[0] as Of<'grades'>
  assert.deepEqual(one.grades, [{ it: 'obbligatoria', grade: '3' }])
  const same = rowCellsOf(multipitch, { grado_max: '5b', grado_obbligatorio: '5b' }, [], null)[0] as Of<'grades'>
  assert.deepEqual(same.grades, [{ it: 'max', grade: '5b' }])
  assert.equal(rowCellsOf(multipitch, {}, [], null)[0], null, 'no grade, an empty column')
})
