import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scalesInUse } from '../../src/domain/grade-scales.ts'
import { chartSteps } from '../../src/domain/quantity.ts'

test('the scales are the ones the registry grades with, alpine first', () => {
  assert.deepEqual(scalesInUse().map(s => s.system), ['alpine', 'sport'])
})

test('a scale names every activity graded on it, through its facts or its parts', () => {
  const by = Object.fromEntries(scalesInUse().map(s => [s.system, s.activities]))
  assert.ok(by.alpine!.includes('Alpinismo'))
  assert.ok(by.sport!.includes('Falesia'), 'a crag is graded through its routes, a part field')
  assert.ok(by.sport!.includes('Multipitch'))
})

test('an activity whose difficulty is free text is on no scale', () => {
  const all = scalesInUse().flatMap(s => s.activities)
  assert.ok(!all.includes('Escursionismo'), 'its Difficoltà is what a contributor wrote, not a step')
  assert.ok(!all.includes('Sci alpinismo'))
})

test('an activity graded on a scale twice is named once', () => {
  const sport = scalesInUse().find(s => s.system === 'sport')!.activities
  assert.equal(sport.filter(a => a === 'Multipitch').length, 1)
})

test('the steps are the chart\'s, a plus counted with its letter', () => {
  const sport = scalesInUse().find(s => s.system === 'sport')!
  assert.deepEqual(sport.steps, chartSteps('sport'))
  assert.ok(!sport.steps.includes('6a+'))
})
