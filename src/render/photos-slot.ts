import type { PhotoRow } from '../db/gita-photo.ts'
import { railMosaic } from './photo-mosaic.ts'
import { html, type Html } from './html.ts'

export interface PhotosSlotOpts {
  readonly sectionId: string
  readonly itineraryId: string
  readonly itineraryName: string
  readonly now?: Date
}

/**
 * The rail's photos: one rounded block of the three newest, lifted like the
 * map, and nothing under it — the +N tile says there are more and leads to
 * all of them (photos-footer-options.html). Absent with no photos: an empty *Foto* heading would be worse than no
 * heading, the same rule every other furniture section already follows.
 */
export function photosSlot(photos: readonly PhotoRow[], opts: PhotosSlotOpts): Html | null {
  const block = railMosaic(photos, {
    itineraryId: opts.itineraryId, itineraryName: opts.itineraryName, now: opts.now ?? new Date(),
  })
  if (!block) return null

  return html`<section id="${opts.sectionId}">
        <h2>Foto</h2>
        ${block}
      </section>`
}
