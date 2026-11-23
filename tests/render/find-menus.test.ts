import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain browser module, without types
import { rangeOf, selectedOf, moveEnd, nearestEnd, familiesOf, phraseOf } from '../../public/find-menus.js'

test('the ruler reads the two menus, the first option of each being the open end', () => {
  assert.deepEqual(rangeOf(0, 0, 32), { lo: 0, hi: 31 }, 'fino … in su is the whole scale')
  assert.deepEqual(rangeOf(14, 20, 32), { lo: 13, hi: 19 })
})

test('and writes them back, an end at the edge of the scale left open', () => {
  assert.deepEqual(selectedOf(0, 31, 32), { lo: 0, hi: 0 })
  assert.deepEqual(selectedOf(13, 19, 32), { lo: 14, hi: 20 })
  for (const r of [{ lo: 3, hi: 3 }, { lo: 0, hi: 7 }, { lo: 9, hi: 31 }]) {
    const s = selectedOf(r.lo, r.hi, 32)
    assert.deepEqual(rangeOf(s.lo, s.hi, 32), r, 'a round trip changes nothing')
  }
})

test('an end never passes the other, nor leaves the scale', () => {
  const r = { lo: 10, hi: 15 }
  assert.deepEqual(moveEnd('lo', 20, r, 32), { lo: 15, hi: 15 })
  assert.deepEqual(moveEnd('hi', 2, r, 32), { lo: 10, hi: 10 })
  assert.deepEqual(moveEnd('lo', -4, r, 32), { lo: 0, hi: 15 })
  assert.deepEqual(moveEnd('hi', 99, r, 32), { lo: 10, hi: 31 })
})

test('a press takes the end beyond it, or the closer one inside the range', () => {
  const r = { lo: 10, hi: 20 }
  assert.equal(nearestEnd(4, r), 'lo')
  assert.equal(nearestEnd(25, r), 'hi')
  assert.equal(nearestEnd(12, r), 'lo')
  assert.equal(nearestEnd(18, r), 'hi')
})

test('the scale is labelled by family: grade band, else the grade without its sign', () => {
  assert.deepEqual(familiesOf(['5c+', '6a', '6a+', '7a'], ['5', '6', '6', '7']).map((f: { key: string }) => f.key), ['5', '6', '7'])
  assert.deepEqual(familiesOf(['F', 'F+', 'PD-', 'PD', 'PD+'], [null, null, null, null, null]),
    [{ key: 'F', from: 0, to: 1 }, { key: 'PD', from: 2, to: 4 }])
})

test('a grade added on the ruler is written as the parser reads it', () => {
  const g = ['3', '4a', '5a', '6a', '7a']
  assert.equal(phraseOf({ lo: 3, hi: 4 }, g), 'dal 6a', 'up to the top is a floor')
  assert.equal(phraseOf({ lo: 0, hi: 3 }, g), 'al 6a', 'from the bottom is a ceiling')
  assert.equal(phraseOf({ lo: 2, hi: 3 }, g), 'dal 5a al 6a')
  assert.equal(phraseOf({ lo: 0, hi: 4 }, g), '', 'the whole scale adds nothing')
})
