/**
 * A photo's width and height as a browser will draw it, read from its own
 * bytes: what lets a page lay photos out at their shape before any of them has
 * loaded (the wall on `/foto`, photos-page-options.html, B).
 *
 * Only the two formats the archive accepts. A JPEG's size is in its frame
 * header (SOF); a phone's photo is often stored on its side with an EXIF flag
 * saying to turn it, and a browser honours the flag, so a quarter turn swaps
 * the two. Null for bytes it cannot read — the page then falls back to a
 * plain frame rather than a guessed shape.
 */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return sized(u32(bytes, 16), u32(bytes, 20))
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes)
  return null
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let turned = false
  let at = 2
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]!
    if (marker === 0xff) { at++; continue }               // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue }
    const len = u16(b, at + 2)
    if (len < 2) return null
    if (marker === 0xe1) turned ||= quarterTurn(b, at + 4, at + 2 + len)
    // Every SOF marker but DHT (C4), JPG (C8) and DAC (CC) carries the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > b.length) return null
      const height = u16(b, at + 5), width = u16(b, at + 7)
      return turned ? sized(height, width) : sized(width, height)
    }
    if (marker === 0xd9 || marker === 0xda) return null    // end, or the image data, before any size
    at += 2 + len
  }
  return null
}

/** Whether an APP1 Exif block says to turn the image a quarter (orientations 5 to 8). */
function quarterTurn(b: Uint8Array, start: number, end: number): boolean {
  // "Exif\0\0", then a TIFF header: byte order, 42, offset of the first IFD.
  if (end - start < 14 || String.fromCharCode(...b.subarray(start, start + 4)) !== 'Exif') return false
  const tiff = start + 6
  const little = b[tiff] === 0x49
  const r16 = (i: number) => little ? b[i]! | (b[i + 1]! << 8) : u16(b, i)
  const r32 = (i: number) => little ? (r16(i) | (r16(i + 2) << 16)) >>> 0 : u32(b, i)
  const ifd = tiff + r32(tiff + 4)
  if (ifd + 2 > end) return false
  const n = r16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > end) return false
    if (r16(e) === 0x0112) return r16(e + 8) >= 5 && r16(e + 8) <= 8
  }
  return false
}

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
const sized = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null
