import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessPoints, distanceM, boundingBox } from '../../src/domain/geo.ts'

const MONVISO = { lat: 44.6673, lon: 7.0913 }

test('distance is zero for a point and itself, and symmetric', () => {
  assert.equal(distanceM(MONVISO, MONVISO), 0)
  const other = { lat: 44.7, lon: 7.2 }
  assert.equal(distanceM(MONVISO, other), distanceM(other, MONVISO))
})

test('one degree of latitude is about 111.2 km, anywhere', () => {
  const d = distanceM(MONVISO, { lat: MONVISO.lat + 1, lon: MONVISO.lon })
  assert.ok(Math.abs(d - 111195) < 10, `expected ~111195 m, got ${d}`)
})

test('one degree of longitude shortens with latitude', () => {
  const d = distanceM(MONVISO, { lat: MONVISO.lat, lon: MONVISO.lon + 1 })
  assert.ok(d > 79000 && d < 79200, `expected ~79083 m at 44.67 N, got ${d}`)
})

test('the bounding box contains everything within the radius', () => {
  const box = boundingBox(MONVISO, 5000)
  const dueNorth = { lat: MONVISO.lat + 5000 / 111195, lon: MONVISO.lon }
  const dueEast  = { lat: MONVISO.lat, lon: MONVISO.lon + 5000 / 79083 }

  for (const p of [dueNorth, dueEast]) {
    assert.ok(p.lat >= box.minLat && p.lat <= box.maxLat, 'latitude inside')
    assert.ok(p.lon >= box.minLon && p.lon <= box.maxLon, 'longitude inside')
  }
  assert.ok(box.maxLon - box.minLon > box.maxLat - box.minLat,
            'at 44 N the box is wider in longitude than in latitude')
})

test('the box is a prefilter, not an answer: its corner is outside the radius', () => {
  const box = boundingBox(MONVISO, 5000)
  const corner = { lat: box.maxLat, lon: box.maxLon }
  assert.ok(distanceM(MONVISO, corner) > 5000,
            'which is exactly why the SQL prefilter must be refined in code')
})

test('an own point that is the parking itself is not a second point', () => {
  const at = { lat: 44.51007, lon: 6.92355 }
  assert.deepEqual(accessPoints({ ...at, parkingLat: at.lat, parkingLon: at.lon }), { parking: at, own: null })
  assert.deepEqual(accessPoints({ lat: 44.512, lon: 6.92, parkingLat: at.lat, parkingLon: at.lon }),
    { parking: at, own: { lat: 44.512, lon: 6.92 } })
  assert.deepEqual(accessPoints({ ...at, parkingLat: null, parkingLon: null }), { parking: null, own: at })
})
