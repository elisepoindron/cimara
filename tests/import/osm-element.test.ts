import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineOf, osmId, pointOf, thin } from '../../src/import/osm/element.ts'
import { aspectOf } from '../../src/import/osm/terrain.ts'

test('an element is named as osm.org short links name it', () => {
  assert.equal(osmId({ type: 'node', id: 1 }), 'n1')
  assert.equal(osmId({ type: 'way', id: 2 }), 'w2')
  assert.equal(osmId({ type: 'relation', id: 3 }), 'r3')
})

test('a node is where it is, a route where it starts, a crag at its centre', () => {
  assert.deepEqual(pointOf({ type: 'node', id: 1, lat: 45, lon: 7 }), { lat: 45, lon: 7 })
  const route = { type: 'relation' as const, id: 2, tags: { route: 'hiking' },
    members: [{ type: 'way', geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }, { type: 'way', geometry: [{ lat: 5, lon: 6 }] }] }
  assert.deepEqual(pointOf(route), { lat: 1, lon: 2 })
  assert.equal(lineOf(route).length, 3)
  const cliff = { type: 'way' as const, id: 3, tags: { sport: 'climbing' }, center: { lat: 9, lon: 9 },
    geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }
  assert.deepEqual(pointOf(cliff), { lat: 9, lon: 9 })
  assert.equal(pointOf({ type: 'relation', id: 4, members: [{ type: 'relation' }] }), null)
})

test('thinning keeps the first and the last point', () => {
  const pts = Array.from({ length: 101 }, (_, i) => i)
  const kept = thin(pts, 11)
  assert.equal(kept.length, 11)
  assert.equal(kept[0], 0)
  assert.equal(kept.at(-1), 100)
  assert.deepEqual(thin([1, 2], 60), [1, 2])
})

test('the ground faces down its slope', () => {
  // Higher to the north: it faces south.
  const south = aspectOf([1000, 1050, 950, 1000, 1000], 60)
  assert.equal(south.facing, 180)
  assert.ok(south.slope! > 30)
  // Higher to the east: it faces west.
  assert.equal(aspectOf([1000, 1000, 1000, 1050, 950], 60).facing, 270)
  assert.equal(aspectOf([500, 500, 500, 500, 500], 60).slope, 0)
})
