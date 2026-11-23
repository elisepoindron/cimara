import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { photosSlot } from '../../src/render/photos-slot.ts'
import type { PhotoRow } from '../../src/db/gita-photo.ts'

const dom = (m: string) => parseHTML(`<!doctype html><html><body>${m}</body></html>`).document

const opts = { sectionId: 'foto', itineraryId: 'i1', itineraryName: 'Monviso, Cresta Est',
               now: new Date('2026-09-17T00:00:00.000Z') }

const PHOTO: PhotoRow = {
  id: 'ph1', position: 0, caption: 'La parete est', mime: 'image/jpeg',
  gitaId: 'g1', authorName: 'vale74', observedAt: '2026-09-10', credit: null }

const many = (n: number, gite = 1): PhotoRow[] =>
  Array.from({ length: n }, (_, i) => ({ ...PHOTO, id: `ph${i}`, position: i % 6, gitaId: `g${i % gite}` }))

test('with no photos, the section is absent — not an empty heading', () => {
  assert.equal(photosSlot([], opts), null)
})

test('a photo is a tile whose src names the id and the right extension, linked to its viewer in the gallery', () => {
  const doc = dom(render(photosSlot([PHOTO], opts)!))
  const tile = doc.querySelector('.mo a.mo__t')

  assert.equal(tile?.querySelector('img')?.getAttribute('src'), '/foto/ph1.jpg')
  assert.equal(tile?.getAttribute('href'), '/itinerario/i1/foto#lb-ph1')
  assert.equal(tile?.getAttribute('data-cap'), 'La parete est')
  assert.equal(tile?.getAttribute('data-by'), 'vale74', 'who took it: on a filed report, its author')
  assert.equal(tile?.getAttribute('data-day'), '10 set 2026', 'a date, never how long ago')
  assert.equal(tile?.getAttribute('data-report'), '/itinerario/i1/relazioni#relazione-g1')
  assert.equal(tile?.hasAttribute('data-lic'), false, 'a filed photo carries no licence')
})

test('a photo with no caption has a generic alt and nothing for the viewer to say', () => {
  const doc = dom(render(photosSlot([{ ...PHOTO, caption: null }], opts)!))

  assert.equal(doc.querySelector('.mo img')?.getAttribute('alt'), 'Foto di Monviso, Cresta Est')
  assert.equal(doc.querySelector('.mo a')?.getAttribute('data-cap'), '')
})

test('the newest photo carries its date', () => {
  const doc = dom(render(photosSlot([PHOTO], opts)!))
  assert.equal(doc.querySelector('.mo__chip')?.textContent, '10 set 2026')
})

test('three show in the rail, the third counting the rest; every photo is in the block for the viewer', () => {
  const doc = dom(render(photosSlot(many(5), opts)!))

  assert.equal(doc.querySelectorAll('.mo a.mo__t:not([hidden])').length, 3)
  assert.equal(doc.querySelectorAll('.mo a.mo__t').length, 5)
  assert.equal(doc.querySelector('.mo a.mo__t:nth-child(3) .mo__more')?.textContent, '+2')
  assert.ok(doc.querySelector('.mo')?.classList.contains('mo--rail3'))
})

test('fewer than three photos: as many tiles, no count', () => {
  const doc = dom(render(photosSlot(many(2), opts)!))
  assert.equal(doc.querySelectorAll('.mo a.mo__t').length, 2)
  assert.equal(doc.querySelectorAll('.mo__more').length, 0)
  assert.ok(doc.querySelector('.mo')?.classList.contains('mo--rail2'))
})

test('nothing under the block: the +N tile is the way to every photo, and says how many', () => {
  const doc = dom(render(photosSlot(many(7, 3), opts)!))

  assert.equal(doc.querySelectorAll('.mo__foot').length, 0)
  const all = doc.querySelector('.mo a.mo__t:nth-child(3)')
  assert.equal(all?.getAttribute('href'), '/itinerario/i1/foto')
  assert.ok(all?.hasAttribute('data-all'), 'the viewer lets this click through')
  assert.ok(all?.hasAttribute('data-zoom'), 'still in the sequence the arrows step through')
  assert.equal(all?.getAttribute('aria-label'), 'Vedile tutte, 7 foto')
  assert.equal(doc.querySelectorAll('[data-all]').length, 1)
  assert.equal(doc.querySelector('.mo a.mo__t:nth-child(1)')?.getAttribute('href'), '/itinerario/i1/foto#lb-ph0')
})

test('three photos or fewer: every tile opens the viewer, none leads away', () => {
  const doc = dom(render(photosSlot(many(3), opts)!))
  assert.equal(doc.querySelectorAll('[data-all]').length, 0)
})

test('the block brings its viewer with it', () => {
  const doc = dom(render(photosSlot([PHOTO], opts)!))
  assert.equal(doc.querySelector('script')?.getAttribute('src'), '/photo-zoom.js')
})

test('the section carries the id the registry declared', () => {
  const doc = dom(render(photosSlot([PHOTO], { ...opts, sectionId: 'foto-custom' })!))
  assert.equal(doc.querySelector('section')?.getAttribute('id'), 'foto-custom')
})

test("the viewer names an imported photo's photographer, once, with its licence and original", () => {
  const photo: PhotoRow = { ...PHOTO, authorName: null,
    credit: { author: 'Mario Rossi', licence: 'CC BY 4.0', licenceUrl: null, source: 'https://example.org/x' } }
  const tile = dom(render(photosSlot([photo], opts)!)).querySelector('[data-zoom]')
  assert.equal(tile?.getAttribute('data-by'), 'Mario Rossi', 'the photographer, never Importata beside them')
  assert.equal(tile?.getAttribute('data-lic'), 'CC BY 4.0')
  assert.equal(tile?.getAttribute('data-src'), 'https://example.org/x')
})
