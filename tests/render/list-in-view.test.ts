import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain browser module, without types
import { viewParam, holdsAll, addressOf } from '../../public/list-in-view.js'

import { readFileSync } from 'node:fs'

// A search typed on the home swaps Find in around the home's own map, which
// find-live.js keeps: if only find-map.js wired the list, a visitor who came in
// through the home would see a list that never followed the map.
test('the home map and the Find map both keep the list in step with the map', () => {
  for (const file of ['home-map.js', 'find-map.js']) {
    const src = readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8')
    assert.match(src, /^listFollowsMap\(map, colorOf\)/m, file)
  }
})

const box = { west: 7, south: 44, east: 8, north: 45 }
const pin = (lat: number | null, lon: number | null) => ({ id: 'x', name: 'x', lat, lon, activity: 'falesia' })

test('a view travels as west, south, east, north, to four decimals', () => {
  assert.equal(viewParam({ west: 7.123456, south: 44.5, east: 8, north: 45.00001 }), '7.1235,44.5000,8.0000,45.0000')
})

test('the list is the whole answer only while every located pin is in view', () => {
  assert.equal(holdsAll([pin(44.5, 7.5), pin(null, null)], box), true, 'a route with no coordinates never leaves')
  assert.equal(holdsAll([pin(44.5, 7.5), pin(46, 7.5)], box), false)
})

test('the address keeps the line and adds the view only when there is one', () => {
  assert.equal(addressOf('falesia sud', null), '/trova?q=falesia+sud')
  assert.equal(addressOf('falesia', '7.0000,44.0000,8.0000,45.0000'), '/trova?q=falesia&vista=7.0000%2C44.0000%2C8.0000%2C45.0000')
})
