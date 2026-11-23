import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areaOf, type ClimbingArea } from '../../src/import/osm/areas.ts'

const square = (lat: number, lon: number, d: number) => [
  { lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon },
]

test('a boulder is in the area that lists it, before any outline around it', () => {
  const areas: ClimbingArea[] = [
    { osm: 'w1', members: [], rings: [square(45, 7, 1)] },
    { osm: 'r2', members: ['n9'], rings: [] },
  ]
  assert.deepEqual([...areaOf([{ osm: 'n9', point: { lat: 45.5, lon: 7.5 } }], areas)], [['n9', 'r2']])
})

test('of two outlines around a boulder, the smaller one is its area', () => {
  const areas: ClimbingArea[] = [
    { osm: 'w1', members: [], rings: [square(45, 7, 1)] },
    { osm: 'w2', members: [], rings: [square(45.4, 7.4, 0.2)] },
  ]
  assert.equal(areaOf([{ osm: 'n9', point: { lat: 45.5, lon: 7.5 } }], areas).get('n9'), 'w2')
})

test('a boulder nobody listed or drew around has no area, however close the others are', () => {
  const areas: ClimbingArea[] = [{ osm: 'w1', members: [], rings: [square(45, 7, 0.01)] }]
  const found = areaOf([
    { osm: 'n8', point: { lat: 46, lon: 8 } }, { osm: 'n9', point: { lat: 46.0001, lon: 8.0001 } }, { osm: 'n7', point: null },
  ], areas)
  assert.equal(found.size, 0)
})

test('an area is never its own area', () => {
  const areas: ClimbingArea[] = [{ osm: 'r1', members: ['r1'], rings: [square(45, 7, 1)] }]
  assert.equal(areaOf([{ osm: 'r1', point: { lat: 45.5, lon: 7.5 } }], areas).size, 0)
})
