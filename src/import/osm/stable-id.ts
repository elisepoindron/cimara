import { createHash } from 'node:crypto'

/**
 * A demo itinerary's id, the same on every build: derived from the
 * OpenStreetMap id of the place it was written from, so a page's address
 * (`/itinerario/<id>`) survives the demo being rebuilt and redeployed, and a
 * link someone shared keeps working.
 *
 * Shaped as the archive's other ids are, a UUID: a name-based one (version 5,
 * RFC 4122 variant) over a SHA-1 of the OpenStreetMap id.
 */
export function osmItineraryId(osm: string): string {
  const h = createHash('sha1').update(`itinerary:osm:${osm}`).digest().subarray(0, 16)
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
