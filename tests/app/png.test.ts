import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePng, PngRefused } from '../../src/app/png.ts'
import { encodePng } from '../helpers/terrain.ts'

const pixel = (x: number, y: number) => [(x * 37 + y * 11) & 255, (x * 5 + y * 101) & 255, (x * y) & 255]

test('reads RGB rows written with every filter, byte for byte', () => {
  const out = decodePng(encodePng(9, 7, 3, pixel, [0, 1, 2, 3, 4]))
  assert.equal(out.width, 9)
  assert.equal(out.height, 7)
  assert.equal(out.channels, 3)
  for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) {
    const o = (y * 9 + x) * 3
    assert.deepEqual([...out.data.subarray(o, o + 3)], pixel(x, y), `pixel ${x},${y}`)
  }
})

test('reads RGBA, keeping the fourth byte', () => {
  const out = decodePng(encodePng(3, 2, 4, (x, y) => [x, y, 7, 200], [4, 3]))
  assert.equal(out.channels, 4)
  assert.deepEqual([...out.data.subarray(4 * 4, 4 * 4 + 4)], [1, 1, 7, 200])
})

test('refuses what is not a PNG, and what it does not read, by name', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), PngRefused)
  const png = encodePng(2, 2, 3, pixel)
  png[8 + 8 + 9] = 3 // IHDR's colour type: a palette
  assert.throws(() => decodePng(png), /colour type 3/)
})
