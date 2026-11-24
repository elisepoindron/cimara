import { crc32, deflateSync } from 'node:zlib'
import type { FetchTile } from '../../src/app/terrain.ts'
import type { Db } from '../../src/db/open.ts'

/** A PNG of RGB or RGBA rows, each row written with the filter given for it (0–4), as an encoder would. */
export function encodePng(
  width: number, height: number, channels: 3 | 4, pixel: (x: number, y: number) => number[], filters: readonly number[] = [0],
): Uint8Array {
  const stride = width * channels
  const rows: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) row.push(...pixel(x, y))
    rows.push(row)
  }
  const raw: number[] = []
  rows.forEach((row, y) => {
    const f = filters[y % filters.length]!
    raw.push(f)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0
      const b = y > 0 ? rows[y - 1]![i]! : 0
      const c = y > 0 && i >= channels ? rows[y - 1]![i - channels]! : 0
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      })()
      raw.push((row[i]! - pred) & 255)
    }
  })
  const chunk = (type: string, body: Uint8Array) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
    return Buffer.concat([head, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0)),
  ]))
}

/** A height as a terrarium pixel. */
export const terrarium = (h: number) => {
  const v = h + 32768
  return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256) % 256]
}

/** The tile row a latitude falls in, at zoom z. */
export const tileRow = (lat: number, z: number) => {
  const r = lat * Math.PI / 180
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z)
}

/** Metres a pixel spans at a latitude, for tiles of `size` pixels at zoom z. */
export const metresPerPixel = (lat: number, z: number, size: number) =>
  40_075_016.686 * Math.cos(lat * Math.PI / 180) / (2 ** z * size)

/**
 * Tiles of an inclined plane: the ground rises `rise` metres for every pixel
 * southwards, `base` metres high at the top of tile row `row0`, a slope of
 * known angle. Every tile asked for is counted in `asked`.
 */
export function planeTiles(base: number, rise: number, row0: number, size = 64, asked: string[] = []): FetchTile {
  return async (z, x, y) => {
    asked.push(`${z}/${x}/${y}`)
    return encodePng(size, size, 3, (_i, j) => terrarium(base + rise * ((y - row0) * size + j)), [0, 1, 2, 3, 4])
  }
}

/** A route to hang a profile on, in a fresh database. */
export async function someItinerary(db: Db): Promise<string> {
  const id = crypto.randomUUID(), place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, created) values (?, 'escursionismo', ?, 'Giro di prova', '{}', ?)`,
    [id, place, new Date().toISOString()])
  return id
}
