import { inflateSync } from 'node:zlib'

/**
 * Just enough PNG to read a terrain tile: 8-bit RGB or RGBA, not interlaced,
 * which every terrarium tile is. Node ships zlib, so this costs no dependency;
 * anything else is refused by name rather than read wrong.
 */
export interface Pixels {
  readonly width: number
  readonly height: number
  /** Bytes per pixel: 3 for RGB, 4 for RGBA. */
  readonly channels: number
  readonly data: Uint8Array
}

export class PngRefused extends Error {}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function decodePng(bytes: Uint8Array): Pixels {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new PngRefused('not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0, channels = 0
  const idat: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const depth = body[8], colour = body[9], interlace = body[12]
      if (depth !== 8) throw new PngRefused(`bit depth ${depth}, only 8 is read`)
      if (interlace !== 0) throw new PngRefused('interlaced')
      if (colour === 2) channels = 3
      else if (colour === 6) channels = 4
      else throw new PngRefused(`colour type ${colour}, only RGB and RGBA are read`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!width || !height || !channels) throw new PngRefused('no header')

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new PngRefused('image data too short')
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!
      const a = i >= channels ? out[row + i - channels]! : 0
      const b = y > 0 ? out[row - stride + i]! : 0
      const c = y > 0 && i >= channels ? out[row - stride + i - channels]! : 0
      let v: number
      switch (filter) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new PngRefused(`filter ${filter}`)
      }
      out[row + i] = v & 255
    }
  }
  return { width, height, channels, data: out }
}
