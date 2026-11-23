import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { gitaForm, WORDS_MAX, CAPTION_MAX } from '../../src/render/gita-form.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import type { PendingPhotoRow } from '../../src/db/pending-photo.ts'

// A fragment, not a page: wrapped the way every other render test wraps one.
// The `<html>` is load bearing — linkedom 0.18 leaves `document.body` a
// permanently empty sibling unless the markup opens an `<html>` element, and
// `doc.body.textContent` would silently be '' for every assertion below.
const dom = (m: string) =>
  parseHTML(`<!doctype html><html><body>${m}</body></html>`).document

const base = { itineraryId: 'i1', itineraryName: 'Monviso, Cresta Est',
               csrf: 't', today: '2026-09-11', photos: [] }

// Never assert a DOM node against null. `assert` formats a failure with
// `depth: 1000, getters: true`, and a linkedom node answers that by unfolding
// the whole document through its getters — 1.2MB for a four-element page, and
// for a real form it does not finish, so the run is killed and the file reports
// `'test failed'` with no line and no message. Naming what was found fails in
// microseconds and says which control turned up.
const nameOf = (doc: Document, selector: string) =>
  doc.querySelector(selector)?.getAttribute('name') ?? null

test('a report asks for the day, the words and the photos, and nothing else', () => {
  for (const id of ['alpinismo', 'falesia']) {
    const doc = dom(render(gitaForm({ ...base, schema: activityOf(id) })))
    const fields = [...doc.querySelectorAll('input:not([type=hidden]), textarea, select')]
      .map(e => e.getAttribute('name'))
    assert.deepEqual(fields, ['quando', 'parole'], id)
    assert.equal(doc.querySelectorAll('input[name=verdetto]').length, 0, 'nothing to rate')
    assert.doesNotMatch(doc.body.textContent!, /Come l’hai trovata/)
  }
})

test('the words suggest what is worth saying, without making it a field', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('falesia') })))
  assert.match(doc.querySelector('[name=parole]')!.getAttribute('placeholder')!, /roccia/)
})

test('the date defaults to today and stays editable', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo') })))
  const date = doc.querySelector('[name=quando]')!

  assert.equal(date.getAttribute('type'), 'date')
  assert.equal(date.getAttribute('value'), '2026-09-11')
})

test('the form carries the token and the itinerary it belongs to', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo') })))

  assert.equal(doc.querySelector('[name=csrf]')?.getAttribute('value'), 't')
  assert.equal(doc.querySelector('[name=itinerario]')?.getAttribute('value'), 'i1')
  assert.equal(doc.querySelector('form')?.getAttribute('action'), '/gita')
})

test('a failed submission gives back everything that was typed', () => {
  const doc = dom(render(gitaForm({
    ...base, schema: activityOf('alpinismo'),
    problems: ['Il giorno della gita è nel futuro.'],
    values: new Map([['quando', '2026-09-07'],
                     ['parole', 'Un paragrafo lungo che nessuno vuole riscrivere.']]),
  })))

  assert.equal(doc.querySelector('[name=quando]')?.getAttribute('value'), '2026-09-07')
  assert.match(doc.querySelector('[name=parole]')!.textContent!, /Un paragrafo lungo/)
  assert.match(doc.body.textContent!, /Il giorno della gita è nel futuro\./)
})

test('the composer names no activity: the choice is the quantity, never the id', () => {
  const source = readFileSync(new URL('../../src/render/gita-form.ts', import.meta.url), 'utf8')
  // Prose may name an activity — the comments explain the registry by example.
  // Code may not: an activity id as a literal, or the id read off the schema at
  // all, is the branch the registry exists to delete.
  for (const form of [`'alpinismo'`, `"alpinismo"`, `'falesia'`, `"falesia"`,
                      'schema.id', 'opts.schema.id']) {
    assert.equal(source.includes(form), false,
      `gita-form.ts contains ${form} — a form per activity is what the registry replaces`)
  }
})

test('the words are capped, so one report cannot outgrow the rail', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo') })))
  assert.equal(doc.querySelector('[name=parole]')?.getAttribute('maxlength'), String(WORDS_MAX))
  assert.equal(WORDS_MAX, 4000)
})

test('nothing typed, and no itinerary name, can become markup', () => {
  const nasty = `<script>alert("x")</script>" onmouseover="alert(1)`
  const doc = dom(render(gitaForm({
    ...base,
    schema: activityOf('alpinismo'),
    itineraryId: `i1" data-x="`,
    itineraryName: nasty,
    problems: ['<img src=x onerror="alert(1)">'],
    values: new Map([['quando', nasty], ['parole', `</textarea><script>alert(2)</script>`]]),
  })))

  assert.equal(doc.querySelectorAll('script').length, 0, 'no injected script survived')
  assert.equal(doc.querySelectorAll('img').length, 0, 'nor an image with a handler on it')
  assert.equal(doc.querySelectorAll('[onmouseover], [onerror]').length, 0,
    'nothing broke out of an attribute into a handler')
  // What was typed comes back as the value it was, character for character.
  assert.equal(doc.querySelector('[name=quando]')?.getAttribute('value'), nasty)
  assert.equal(doc.querySelector('[name=itinerario]')?.getAttribute('value'), `i1" data-x="`)
  const parole = doc.querySelector('[name=parole]')!
  assert.equal(doc.querySelectorAll('textarea').length, 1, 'the textarea was not closed early')
  assert.equal(parole.childNodes.length, 1, 'and holds one run of text, not markup')
  // linkedom keeps a textarea's content as raw source where a browser decodes
  // it, so these entities are the proof the brackets were escaped on the way
  // out — not what the climber would read back in the box.
  assert.equal(parole.textContent, '&lt;/textarea&gt;&lt;script&gt;alert(2)&lt;/script&gt;')
  assert.match(doc.body.textContent!, /alert\("x"\)/, 'the name is on the page, as text')
})

test('a token that is really the client’s own cookie is escaped like any other value', () => {
  const doc = dom(render(gitaForm({
    ...base, schema: activityOf('alpinismo'),
    csrf: `"><script>alert(1)</script>`,
  })))

  assert.equal(doc.querySelectorAll('script').length, 0)
  assert.equal(doc.querySelector('[name=csrf]')?.getAttribute('value'),
    `"><script>alert(1)</script>`)
})

const PH1: PendingPhotoRow = { id: 'ph1', mime: 'image/jpeg' }
const PH2: PendingPhotoRow = { id: 'ph2', mime: 'image/png' }

test('no photos means no photo figures at all', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo') })))
  assert.equal(doc.querySelectorAll('.gita__foto').length, 0)
})

test('exactly as many figures as photos were actually chosen, keyed by id', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2] })))

  assert.equal(doc.querySelectorAll('.gita__foto').length, 2)
  assert.ok(doc.querySelector('[name=incl_ph1]'))
  assert.ok(doc.querySelector('[name=didascalia_ph1]'))
  assert.ok(doc.querySelector('[name=incl_ph2]'))
  assert.ok(doc.querySelector('[name=didascalia_ph2]'))
})

test('foto_ids carries every photo\'s id, hidden, comma-joined', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2] })))
  const hidden = doc.querySelector('[name=foto_ids]')

  assert.equal(hidden?.getAttribute('type'), 'hidden')
  assert.equal(hidden?.getAttribute('value'), 'ph1,ph2')
})

test('every photo is checked by default, on a fresh render', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2] })))

  assert.equal(doc.querySelector('[name=incl_ph1]')?.hasAttribute('checked'), true)
  assert.equal(doc.querySelector('[name=incl_ph2]')?.hasAttribute('checked'), true)
})

test('a failed publish keeps exactly the checked state it was given, unchecked included', () => {
  const doc = dom(render(gitaForm({
    ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2],
    values: new Map([['incl_ph1', 'on'], ['parole', 'Un racconto.']]),
  })))

  assert.equal(doc.querySelector('[name=incl_ph1]')?.hasAttribute('checked'), true)
  assert.equal(doc.querySelector('[name=incl_ph2]')?.hasAttribute('checked'), false,
    'ph2\'s box was unchecked, so its field never arrived in values at all')
})

test('a typed caption comes back, keyed by the photo\'s own id', () => {
  const doc = dom(render(gitaForm({
    ...base, schema: activityOf('alpinismo'), photos: [PH1],
    values: new Map([['didascalia_ph1', 'La parete est']]),
  })))

  assert.equal(doc.querySelector('[name=didascalia_ph1]')?.getAttribute('value'), 'La parete est')
})

test('each figure is numbered by its position among the photos shown — the same number fileFromForm refuses by', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2] })))
  const imgs = [...doc.querySelectorAll('.gita__foto img')]

  assert.equal(imgs[0]?.getAttribute('alt'), 'Foto 1')
  assert.equal(imgs[1]?.getAttribute('alt'), 'Foto 2')

  const labels = [...doc.querySelectorAll('.gita__foto .incl')]
  assert.match(labels[0]!.textContent!, /\bfoto 1\b/i)
  assert.match(labels[1]!.textContent!, /\bfoto 2\b/i)
})

test('each photo\'s thumbnail points at its own pending url', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1, PH2] })))

  assert.equal(doc.querySelector('.gita__foto img')?.getAttribute('src'), '/foto/pending/ph1.jpg')
  assert.equal(doc.querySelectorAll('.gita__foto img')[1]?.getAttribute('src'), '/foto/pending/ph2.png')
})

test('the composer no longer posts as multipart — screen 2 carries no file input', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('alpinismo'), photos: [PH1] })))
  assert.equal(doc.querySelector('form')?.hasAttribute('enctype'), false)
  assert.equal(doc.querySelectorAll('input[type=file]').length, 0)
})


test('the foot says who signs the relazione, and only when it knows', () => {
  const signed = dom(render(gitaForm({ ...base, schema: activityOf('falesia'), author: 'vale74' })))
  assert.match(signed.querySelector('.sheet__ft')!.textContent!, /Firmata vale74/)

  const unsigned = dom(render(gitaForm({ ...base, schema: activityOf('falesia') })))
  assert.doesNotMatch(unsigned.querySelector('.sheet__ft')!.textContent!, /Firmata/)
  assert.match(unsigned.querySelector('.sheet__ft')!.textContent!, /ritirarla/)
})

test('the words keep a label, for a screen reader, though the eye reads the placeholder', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('falesia') })))
  const label = doc.querySelector('label[for=gita-parole]')
  assert.equal(label?.textContent, 'Com’è andata')
  assert.equal(doc.querySelector('#gita-parole')?.getAttribute('name'), 'parole')
})

test('the running count starts hidden, so without its script nothing promises a count', () => {
  const doc = dom(render(gitaForm({ ...base, schema: activityOf('falesia') })))
  const target = doc.querySelector('[name=parole]')!.getAttribute('data-count')!
  assert.equal(doc.getElementById(target)?.hasAttribute('hidden'), true)
})

test('photos sit under one heading, and none means no photo section at all', () => {
  const none = dom(render(gitaForm({ ...base, schema: activityOf('falesia') })))
  assert.equal(none.querySelectorAll('.sheet__photos').length, 0)

  const two = dom(render(gitaForm({ ...base, schema: activityOf('falesia'), photos: [PH1, PH2] })))
  assert.equal(two.querySelectorAll('.sheet__photos').length, 1)
  assert.equal(two.querySelectorAll('.sheet__photos .gita__foto').length, 2)
})
