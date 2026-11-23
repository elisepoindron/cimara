import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { photoPickPage } from '../../src/render/photo-pick.ts'

const dom = (m: string) => parseHTML(m).document

const base = { itineraryId: 'i1', itineraryName: 'Monviso, Cresta Est', csrf: 't' }

test('one multi-select field, not six fixed slots', () => {
  const doc = dom(photoPickPage(base))
  const input = doc.querySelector('[name=foto]')

  assert.equal(input?.getAttribute('type'), 'file')
  assert.equal(input?.hasAttribute('multiple'), true)
  assert.equal(input?.getAttribute('accept'), 'image/jpeg,image/png')
  assert.equal(doc.querySelector('[name=foto_1]'), null, 'no fixed slots any more')
})

test('the form posts to /gita/foto, carrying the token and the itinerary', () => {
  const doc = dom(photoPickPage(base))
  const form = doc.querySelector('form')

  assert.equal(form?.getAttribute('action'), '/gita/foto')
  assert.equal(form?.getAttribute('enctype'), 'multipart/form-data')
  assert.equal(doc.querySelector('[name=csrf]')?.getAttribute('value'), 't')
  assert.equal(doc.querySelector('[name=itinerario]')?.getAttribute('value'), 'i1')
})

test('a way to skip photos entirely, without a script forcing a detour', () => {
  const doc = dom(photoPickPage(base))
  const skip = doc.querySelector('a[href^="/gita/nuova"]')

  assert.match(skip?.getAttribute('href') ?? '', /itinerario=i1/)
  assert.match(skip?.getAttribute('href') ?? '', /foto=$/, 'foto present as the empty key, not absent')
})

test('a failed upload reports its problems', () => {
  const doc = dom(photoPickPage({ ...base, problems: ['Foto 2: solo JPEG o PNG.'] }))
  assert.match(doc.querySelector('.problems')?.textContent ?? '', /Foto 2/)
})

test('nothing typed can become markup', () => {
  const doc = dom(photoPickPage({
    ...base, itineraryName: `<script>alert(1)</script>`, csrf: `"><script>alert(2)</script>`,
  }))
  assert.equal(doc.querySelectorAll('script:not([src="/page-motion.js"]):not([src="/ground-motion.js"]):not([src="/grade-nine.js"])').length, 0,
    'only the shell’s own two motion scripts')
})

test('the picker says how many photos it takes, from the same cap the route enforces', async () => {
  const { PHOTOS_MAX } = await import('../../src/app/gite.ts')
  const doc = dom(photoPickPage(base))
  assert.match(doc.querySelector('.sheet__pick small')?.textContent ?? '', new RegExp(`Fino a ${PHOTOS_MAX}\\b`))
})
