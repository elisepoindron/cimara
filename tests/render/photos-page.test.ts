import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { photosPage } from '../../src/render/photos-page.ts'
import type { PhotoRow } from '../../src/db/gita-photo.ts'

const base = { itineraryId: 'i1', itineraryName: 'Monviso, Cresta Est',
               now: new Date('2026-09-17T00:00:00.000Z') }

const PHOTO: PhotoRow = {
  id: 'ph1', position: 0, caption: 'La parete est', mime: 'image/jpeg',
  gitaId: 'g1', authorName: 'vale74', observedAt: '2026-09-10', credit: null }

test('every photo renders on one wall, unpaginated', () => {
  const many: PhotoRow[] = Array.from({ length: 9 }, (_, i) => ({ ...PHOTO, id: `ph${i}`, position: i }))
  const doc = parseHTML(photosPage({ ...base, photos: many })).document

  assert.equal(doc.querySelectorAll('.wall .mo__t').length, 9, 'no pagination — every standing photo, as giteFor lists every standing report')
  assert.equal(doc.querySelectorAll('.wall').length, 1, 'one wall, not a block per report')
})

test('the page is Tutte le foto, under a crumb back to the itinerary', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  assert.equal(doc.querySelector('h1')?.textContent, 'Tutte le foto')
  const crumb = doc.querySelector('.crumb a')
  assert.equal(crumb?.getAttribute('href'), '/itinerario/i1')
  assert.equal(crumb?.textContent, 'Monviso, Cresta Est')
})

test('the count says how many photos, from how many reports, and the last day', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO, { ...PHOTO, id: 'ph1b', position: 1 }, PHOTO2] })).document
  assert.equal(doc.querySelector('.fcount')?.textContent, '3 foto da 2 relazioni · l\u2019ultima il 10 set 2026')
})

test('with no photos, the page says so rather than showing a blank wall', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [] })).document
  assert.equal(doc.querySelectorAll('.wall').length, 0)
  assert.equal(doc.querySelectorAll('.fcount').length, 0)
  // documentElement, not body: see tests/render/account.test.ts for linkedom's implicit-body quirk.
  assert.match(doc.documentElement.textContent ?? '', /Nessuna foto/)
})

const PHOTO2: PhotoRow = {
  id: 'ph2', position: 0, caption: null, mime: 'image/jpeg',
  gitaId: 'g2', authorName: 'marco_t', observedAt: '2026-09-05', credit: null }

test("the day is on the first photo of each report, and only there", () => {
  const second = { ...PHOTO, id: 'ph1b', position: 1 }
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO, second, PHOTO2] })).document
  const chips = [...doc.querySelectorAll('.wall .mo__t')].map(t => t.querySelector('.mo__chip')?.textContent ?? null)
  assert.deepEqual(chips, ['10 set 2026', null, '5 set 2026'])
})

test('each photo is laid out at its own shape, or a plain 4:3 frame without one', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [{ ...PHOTO, width: 768, height: 1024 }, PHOTO2] })).document
  const styles = [...doc.querySelectorAll('.wall .mo__t')].map(t => t.getAttribute('style'))
  assert.deepEqual(styles, ['--r:0.750', '--r:1.333'])
})

test('every photo opens in the viewer, with what the viewer says, and its own no-script viewer', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  const tile = doc.querySelector('.wall .mo__t')

  assert.equal(tile?.getAttribute('href'), '#lb-ph1')
  assert.equal(tile?.hasAttribute('data-zoom'), true)
  assert.equal(tile?.getAttribute('data-cap'), 'La parete est')
  assert.equal(tile?.getAttribute('data-by'), 'vale74')
  assert.equal(tile?.getAttribute('data-day'), '10 set 2026', 'a date, never how long ago')
  assert.equal(tile?.getAttribute('data-report'), '/itinerario/i1/relazioni#relazione-g1')
  assert.equal(doc.querySelector('#lb-ph1')?.classList.contains('lb'), true)
  assert.equal(doc.querySelector('#lb-ph1 img')?.getAttribute('src'), '/foto/ph1.jpg')
  assert.ok(doc.querySelector('script[src^="/photo-zoom.js"]'))
})

test("the full-size view carries the caption and a byline, without a verdict", () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  const cap = doc.querySelector('#lb-ph1 .lb__cap')

  assert.match(cap?.textContent ?? '', /La parete est/)
  assert.match(cap?.textContent ?? '', /vale74/)
  assert.doesNotMatch(cap?.textContent ?? '', /Buone/)
})

test('next and previous chain through every photo in order, wrapping at the ends', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO, PHOTO2] })).document

  assert.equal(doc.querySelector('#lb-ph1 .lb__next')?.getAttribute('href'), '#lb-ph2')
  assert.equal(doc.querySelector('#lb-ph1 .lb__prev')?.getAttribute('href'), '#lb-ph2',
    'only two photos, so each one\'s neighbour in both directions is the other')
  assert.equal(doc.querySelector('#lb-ph2 .lb__next')?.getAttribute('href'), '#lb-ph1')
})

test('closing the viewer is an icon, not the Italian word, but still has an accessible name', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  const close = doc.querySelector('#lb-ph1 .lb__close')

  assert.equal(close?.getAttribute('aria-label'), 'Chiudi')
  assert.ok(close?.querySelector('svg'), 'an icon takes the word\'s place')
  assert.doesNotMatch(close?.textContent ?? '', /Chiudi/, 'the word moved to aria-label, not both')
})

test('the page loads its own keyboard script, scoped to itself', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  const script = doc.querySelector('script[src^="/gallery-lightbox.js"]')

  assert.equal(script?.getAttribute('type'), 'module')
})

const LICENSED: PhotoRow = {
  ...PHOTO, id: 'im1', gitaId: 'ir1', authorName: null, caption: null,
  credit: { author: 'Mario Rossi', licence: 'CC BY-SA 4.0',
            licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
            source: 'https://commons.wikimedia.org/wiki/File:X.jpg' },
}

test("an imported report's photo names who took it, once, and credits it", () => {
  const doc = parseHTML(photosPage({ ...base, photos: [LICENSED] })).document

  const tile = doc.querySelector('.wall .mo__t')
  assert.equal(tile?.getAttribute('data-by'), 'Mario Rossi', 'one name: the photographer')
  assert.equal(tile?.getAttribute('data-lic'), 'CC BY-SA 4.0')
  const links = [...doc.querySelectorAll('.lb__cap .credit a')].map(a => a.getAttribute('href'))
  assert.deepEqual(links, ['https://commons.wikimedia.org/wiki/File:X.jpg',
                           'https://creativecommons.org/licenses/by-sa/4.0'],
    'the no-script viewer links the original and the licence, as the licence asks')
})

test('a filed photo carries no credit line: its author is the report’s', () => {
  const doc = parseHTML(photosPage({ ...base, photos: [PHOTO] })).document
  assert.equal(doc.querySelectorAll('.credit').length, 0)
})
