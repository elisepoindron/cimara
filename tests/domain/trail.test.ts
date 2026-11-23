import { test } from 'node:test'
import assert from 'node:assert/strict'
import { halfwayAlong, trailJoins, walkMinutes, type Trail } from '../../src/domain/trail.ts'

const parking = { lat: 45.0587, lon: 7.1443 }
const crag = { lat: 45.06, lon: 7.15 }
const walk = (coords: [number, number][], lengthM = 600): Trail => ({ coords, lengthM, ascentM: 80 })

test('a trail from the parking to the wall joins them', () => {
  assert.equal(trailJoins(walk([[7.1443, 45.0587], [7.147, 45.0595], [7.15, 45.06]]), parking, crag), true)
})

test('a trail that ends on a path a little off the wall still joins it', () => {
  // about 150 m short, where the router left the last mapped path
  assert.equal(trailJoins(walk([[7.1443, 45.0587], [7.148, 45.0596]]), parking, crag), true)
})

test('a trail that stops short of the wall, past the snap distance, does not', () => {
  // about 500 m short of the crag
  assert.equal(trailJoins(walk([[7.1443, 45.0587], [7.1437, 45.0591]]), parking, crag), false)
})

test('a trail that starts far from the parking does not', () => {
  assert.equal(trailJoins(walk([[7.13, 45.05], [7.15, 45.06]]), parking, crag), false)
})

test('a detour many times the straight distance does not', () => {
  // the two points are about 470 m apart: 4 × 470 + 1000 is the ceiling
  assert.equal(trailJoins(walk([[7.1443, 45.0587], [7.15, 45.06]], 2800), parking, crag), true)
  assert.equal(trailJoins(walk([[7.1443, 45.0587], [7.15, 45.06]], 3200), parking, crag), false)
})

test('a single point is no trail', () => {
  assert.equal(trailJoins(walk([[7.1443, 45.0587]]), parking, crag), false)
})

test('halfway along is measured by distance walked, not by the two ends', () => {
  // an L: a long leg east, then a short leg north
  const [lon, lat] = halfwayAlong([[7.0, 45.0], [7.02, 45.0], [7.02, 45.002]])
  assert.equal(lat, 45.0, 'the midpoint sits on the long leg')
  assert.ok(lon > 7.01 && lon < 7.02)
})

test('walking time: the longer of flat and climb, plus half the shorter, to five minutes', () => {
  const t = (lengthM: number, ascentM: number | null) => walkMinutes({ coords: [], lengthM, ascentM })
  assert.equal(t(2000, 0), 30, '2 km on the flat at 4 km/h')
  assert.equal(t(1260, 243), 60, '0,81 h climbing + 0,16 h flat, rounded')
  assert.equal(t(1000, null), 15, 'no climb figure counts as flat')
  assert.equal(t(50, 0), 5, 'never less than five minutes')
})

test('halfway along two identical points is that point', () => {
  assert.deepEqual(halfwayAlong([[7.1, 45.1], [7.1, 45.1]]), [7.1, 45.1])
})
