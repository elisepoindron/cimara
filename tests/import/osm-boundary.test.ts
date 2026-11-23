import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comuneAt, inRing, ringsOf, type Boundary } from '../../src/import/osm/boundary.ts'

const P = (lat: number, lon: number) => ({ lat, lon })

test('ways are joined into a ring whatever their order and direction', () => {
  const rings = ringsOf([
    [P(0, 0), P(0, 1)],
    [P(1, 1), P(1, 0), P(0, 0)],
    [P(1, 1), P(0, 1)],          // backwards
  ])
  assert.equal(rings.length, 1)
  assert.equal(rings[0]!.length, 5)
  assert.deepEqual(rings[0]![0], rings[0]!.at(-1))
})

test('a chain that never closes contains nothing', () => {
  assert.deepEqual(ringsOf([[P(0, 0), P(0, 1)], [P(0, 1), P(1, 1)]]), [])
})

test('a point is inside a ring, outside it, or in an enclave cut out of it', () => {
  const square = [P(0, 0), P(0, 4), P(4, 4), P(4, 0), P(0, 0)]
  assert.equal(inRing(P(2, 2), square), true)
  assert.equal(inRing(P(5, 2), square), false)
  const hole = [P(1, 1), P(1, 2), P(2, 2), P(2, 1), P(1, 1)]
  const a: Boundary = { name: 'A', istat: '001', outer: [square], inner: [hole] }
  const b: Boundary = { name: 'B', istat: '002', outer: [hole], inner: [] }
  assert.equal(comuneAt([a, b], P(3, 3))?.name, 'A')
  assert.equal(comuneAt([a, b], P(1.5, 1.5))?.name, 'B')
  assert.equal(comuneAt([a, b], P(9, 9)), null)
})
