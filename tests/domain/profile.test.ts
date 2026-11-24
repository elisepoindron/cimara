import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  climbOf, gradeAt, groundAngle, heightAlong, profileOf, resample, STEP_M, type HeightAt,
} from '../../src/domain/profile.ts'
import type { TrackPoint } from '../../src/domain/track.ts'

const M_PER_DEG_LAT = Math.PI * 6_371_000 / 180

/** Ground rising `tanAngle` metres for every metre northwards, from 1000 m at latitude 45. */
const northward = (tanAngle: number): HeightAt => lat => 1000 + (lat - 45) * M_PER_DEG_LAT * tanAngle

/** A straight track due north from latitude 45, `lengthM` long, in fixes `everyM` apart. */
const north = (lengthM: number, everyM: number): TrackPoint[] =>
  Array.from({ length: Math.floor(lengthM / everyM) + 1 }, (_, i) => [7, 45 + i * everyM / M_PER_DEG_LAT, null] as const)

test('resample: a point every fifteen metres, whatever the fixes, and the very end', () => {
  const line = resample(north(1000, 37))
  assert.equal(line[0]!.d, 0)
  for (let i = 1; i < line.length - 1; i++) assert.ok(Math.abs(line[i]!.d - i * STEP_M) < 1e-6)
  assert.ok(Math.abs(line[line.length - 1]!.d - 999) < 1, 'ends where the track ends')
})

test('groundAngle: an inclined plane of 30° reads 30°, flat ground 0°', () => {
  assert.ok(Math.abs(groundAngle(45.01, 7, northward(Math.tan(Math.PI / 6)))! - 30) < 0.01)
  assert.equal(groundAngle(45.01, 7, () => 1200), 0)
  assert.equal(groundAngle(45.01, 7, lat => lat > 45.01 ? null : 1000), null, 'a missing reading is no angle')
})

test('profileOf: up a 20% slope, the path climbs 20% on ground of 11°', () => {
  const p = profileOf(north(1200, 20), northward(0.2))!
  const mid = p[Math.floor(p.length / 2)]!
  assert.equal(mid.g, 20)
  assert.equal(mid.s, 11)
  assert.equal(p[0]!.e, 1000)
  assert.equal(climbOf(p), 240)
})

test('profileOf: across a slope, the path is flat while the ground is steep', () => {
  // The track runs east along latitude 45.01; the ground rises northwards at 35°.
  const east: TrackPoint[] = Array.from({ length: 40 }, (_, i) => [7 + i * 0.0003, 45.01, null] as const)
  const p = profileOf(east, northward(Math.tan(35 * Math.PI / 180)))!
  assert.ok(p.every(s => s.g === 0), 'the path keeps its height')
  assert.ok(p.every(s => s.s === 35), 'the ground beside it is 35°')
})

test('profileOf: a hole in the terrain is no profile, never a patched one', () => {
  const holed: HeightAt = lat => lat > 45.005 ? null : 1000
  assert.equal(profileOf(north(1200, 20), holed), null)
  assert.equal(profileOf([[7, 45, null]], () => 1000), null, 'one point is no line')
})

test('heightAlong and gradeAt read between readings, and shorten at the ends', () => {
  const s = [{ d: 0, e: 100 }, { d: 100, e: 110 }, { d: 200, e: 150 }]
  assert.equal(heightAlong(s, 50), 105)
  assert.equal(heightAlong(s, -5), 100)
  assert.equal(heightAlong(s, 999), 150)
  assert.equal(gradeAt(s, 0, 100), 10, 'only forwards at the start')
  assert.equal(gradeAt(s, 100, 100), 25)
})
