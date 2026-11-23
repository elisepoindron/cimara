import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { giteListPage } from '../../src/render/gite-list-page.ts'
import type { GitaRow } from '../../src/db/gita.ts'
import type { SynthesisRow } from '../../src/db/synthesis.ts'
import type { PhotoRow } from '../../src/db/gita-photo.ts'

const countOf = (doc: Document, selector: string) => doc.querySelectorAll(selector).length

const gita = (over: Partial<GitaRow>): GitaRow => ({
  id: 'g1', itineraryId: 'balma', accountId: 'a1', authorName: 'vale74',
  observedAt: '2026-09-09', filedAt: '2026-09-09', words: 'Roccia asciutta, tutto in ordine.',
  ...over,
})

test('names the route and links back to it', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [],
  })).document

  assert.equal(doc.querySelector('h1')?.textContent, 'Tutte le relazioni')
  const back = doc.querySelector('a[href="/itinerario/balma"]')
  assert.equal(back?.textContent, 'Balma Scura')
})

test('each report says who first, with an initial, then the day and year, then its words in full', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ observedAt: '2026-09-09' })],
  })).document

  assert.equal(doc.querySelector('.slip .slip__words')?.textContent, 'Roccia asciutta, tutto in ordine.')
  assert.equal(doc.querySelector('.slip__who')?.textContent, 'vale74')
  assert.equal(doc.querySelector('.slip__av')?.textContent, 'V')
  assert.equal(doc.querySelector('.slip__d')?.textContent, '9 set 2026')
})

test('each report carries an id its own gita can be linked to directly', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g7' })],
  })).document

  assert.equal(doc.querySelector('#relazione-g7')?.classList.contains('slip'), true)
})

test('reports render in the order given, not resorted', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [
      gita({ id: 'g1', words: 'Prima.' }),
      gita({ id: 'g2', words: 'Seconda.' }),
    ],
  })).document

  assert.deepEqual([...doc.querySelectorAll('.slip__words')].map(p => p.textContent),
    ['Prima.', 'Seconda.'])
})

test('with nothing filed, there is a plain notice and no slips', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [],
  })).document

  assert.equal(countOf(doc, '.slip'), 0)
  assert.equal(doc.querySelector('main')?.textContent?.trim(), 'Nessuna relazione depositata.')
})

test('an imported report is named as one where a filed one names its author', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ accountId: null, authorName: null })],
  })).document
  assert.equal(doc.querySelector('.slip__who')?.textContent, 'Importata')
  assert.equal(countOf(doc, '.slip__av--none'), 1, 'and no initial: there is nobody to name')
})

// ---- what the reading kept ----

const reading = (over: Partial<SynthesisRow> = {}): SynthesisRow => ({
  itineraryId: 'balma', generatedAt: '2026-09-17T10:00:00.000Z', reportCount: 6,
  themes: [], flags: [], reading: 2, readIds: [], ...over,
})

test('with no synthesis, a slip has no foot: date, author and words only', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({})], synthesis: null,
  })).document
  assert.equal(countOf(doc, '.slip__foot'), 0)
  assert.equal(countOf(doc, '.slip__words mark'), 0)
})

test('a report names the themes it was counted in, as plain text, not a link', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g1' }), gita({ id: 'g2' })],
    synthesis: reading({ themes: [
      { label: 'Chiodatura curata', count: 2, reportIds: ['g1', 'g2'] },
      { label: 'Tiri brevi', count: 3, reportIds: ['g2', 'g8', 'g9'] },
    ] }),
  })).document

  const themesOf = (id: string) =>
    [...doc.querySelectorAll(`#relazione-${id} .slip__theme`)].map(a => a.textContent)
  assert.deepEqual(themesOf('g1'), ['Chiodatura curata'])
  assert.deepEqual(themesOf('g2'), ['Chiodatura curata', 'Tiri brevi'])
  assert.equal(countOf(doc, '.slip__themes a'), 0)
})

test('the words a theme quoted are marked in the report, quieter than a flag', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g1', words: 'Spit ravvicinati, luogo molto bello. È caduta la lama del terzo tiro.' })],
    synthesis: reading({
      themes: [
        { label: 'Chiodatura ravvicinata', count: 2, reportIds: ['g1', 'g2'], quotes: { g1: 'Spit ravvicinati' } },
        { label: 'Ambiente bello', count: 2, reportIds: ['g1', 'g2'], quotes: { g1: 'luogo molto bello' } },
        // Inside the flagged sentence: the flag's mark wins, nothing is marked twice.
        { label: 'Lama caduta', count: 2, reportIds: ['g1', 'g2'], quotes: { g1: 'la lama' } },
      ],
      flags: [{
        label: 'Lama caduta sul terzo tiro', kind: 'attenzione',
        reportIds: ['g1'], quotes: { g1: 'È caduta la lama del terzo tiro.' },
      }],
    }),
  })).document

  const marks = [...doc.querySelectorAll('.slip__words mark')]
    .map(m => `${m.getAttribute('class') || 'flag'}: ${m.textContent}`)
  assert.deepEqual(marks, [
    'slip__q: Spit ravvicinati',
    'slip__q: luogo molto bello',
    'flag: È caduta la lama del terzo tiro.',
  ])
  assert.equal(doc.querySelector('.slip__words')?.textContent,
    'Spit ravvicinati, luogo molto bello. È caduta la lama del terzo tiro.', 'no word lost or doubled')
})

const flag = (kind: 'attenzione' | 'novita', label: string, sentence: string) =>
  ({ label, kind, reportIds: ['g1'], quotes: { g1: sentence } })

test('each name in the foot shares a key with the words it was read from, and takes focus', () => {
  const words = 'Spit nuovi sul primo tiro. Una presa si è rotta. Roccia buona, luogo molto bello.'
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({
      flags: [
        flag('novita', 'Spit nuovi', 'Spit nuovi sul primo tiro.'),
        flag('attenzione', 'Presa rotta', 'Una presa si è rotta.'),
      ],
      themes: [
        { label: 'Roccia buona', count: 2, reportIds: ['g1', 'g2'], quotes: { g1: 'Roccia buona' } },
        { label: 'Bel posto', count: 2, reportIds: ['g1', 'g2'], quotes: { g1: 'luogo molto bello' } },
      ],
    }),
  })).document

  const pairs = (selector: string) =>
    [...doc.querySelectorAll(selector)].map(el => `${el.getAttribute('data-k')}: ${el.textContent}`)
  // Care first, then news, then themes, in the tags and in the keys.
  assert.deepEqual(pairs('.slip__tags [data-k]'),
    ['1: Presa rotta', '2: Spit nuovi', '3: Roccia buona', '4: Bel posto'])
  assert.deepEqual(pairs('.slip__words mark').sort(),
    ['1: Una presa si è rotta.', '2: Spit nuovi sul primo tiro.', '3: Roccia buona', '4: luogo molto bello'])
  assert.equal(doc.querySelectorAll('.slip__tags [data-k][tabindex="0"]').length, 4)
})

test('a theme only this report has raised is a tag apart, Per ora solo qui, still paired with its words', () => {
  const words = 'Peccato che i tiri siano corti. Chiodatura ascellare e roccia buona.'
  const t = (label: string, quote: string, voices: number) =>
    ({ label, count: voices, voices, reportIds: ['g1'], quotes: { g1: quote } })
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({ themes: [
      t('Tiri brevi', 'i tiri siano corti', 1),
      t('Chiodatura ravvicinata', 'Chiodatura ascellare', 3),
      t('Roccia buona', 'roccia buona', 2),
    ] }),
  })).document

  const tags = (selector: string) => [...doc.querySelectorAll(selector)].map(e => e.textContent)
  assert.deepEqual(tags('.slip__theme:not(.slip__tag--lone)'), ['Chiodatura ravvicinata', 'Roccia buona'])
  assert.deepEqual(tags('.slip__tag--lone'), ['Tiri brevi'])
  assert.equal(doc.querySelector('.slip__tag--lone')?.getAttribute('title'), 'Per ora solo qui')
  const key = doc.querySelector('.slip__tag--lone')?.getAttribute('data-k')
  assert.equal(doc.querySelector(`mark[data-k="${key}"]`)?.textContent, 'i tiri siano corti')
})

test('a report whose themes are all shared has no Per ora solo qui tag', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1' })],
    synthesis: reading({ themes: [{ label: 'Roccia buona', count: 2, voices: 2, reportIds: ['g1', 'g2'] }] }),
  })).document
  assert.equal(countOf(doc, '.slip__tag--lone'), 0)
  assert.equal(countOf(doc, '.slip__theme'), 1)
})

test('a report counted in no theme says nothing about themes', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1' })],
    synthesis: reading({ themes: [{ label: 'Altro', count: 2, reportIds: ['g5', 'g6'] }] }),
  })).document
  assert.equal(countOf(doc, '.slip__theme'), 0)
})

test('a change that asks for care is a tag named by the change, its sentence marked, the slip coloured', () => {
  const words = 'Bella giornata. Su Ciaplu si è staccata una scaglia sul traverso, ancora fattibile.'
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({ flags: [flag('attenzione', 'Scaglia staccata su Ciaplu', 'Su Ciaplu si è staccata una scaglia sul traverso')] }),
  })).document

  const tag = doc.querySelector('.slip__tag--attenzione')
  assert.equal(tag?.textContent, 'Scaglia staccata su Ciaplu', 'the change itself, never the word Attenzione')
  assert.equal(tag?.getAttribute('title'), 'Attenzione', 'its kind is said by the icon and the title')
  assert.equal(doc.querySelector('.slip__words mark')?.textContent, 'Su Ciaplu si è staccata una scaglia sul traverso')
  assert.equal(doc.querySelector('.slip__words mark')?.getAttribute('class') || '', '')
  // Marking changes nothing about the words themselves.
  assert.equal(doc.querySelector('.slip__words')?.textContent, words)
  assert.equal(doc.querySelector('#relazione-g1')?.classList.contains('slip--flag'), true)
})

test('news is a tag named by the change, marked, and leaves the slip uncoloured', () => {
  const words = 'Giornata piena. Sono stati aggiunti alcuni nuovi tiri a destra.'
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({ flags: [flag('novita', 'Nuovi tiri a destra', 'Sono stati aggiunti alcuni nuovi tiri a destra.')] }),
  })).document

  assert.equal(doc.querySelector('.slip__tag--novita')?.textContent, 'Nuovi tiri a destra')
  assert.equal(doc.querySelector('.slip__tag--novita')?.getAttribute('title'), 'Novità')
  assert.equal(countOf(doc, '.slip__tag--attenzione'), 0)
  assert.equal(doc.querySelector('.slip__words mark')?.getAttribute('class'), 'slip__n')
  assert.equal(doc.querySelector('#relazione-g1')?.classList.contains('slip--flag'), false)
})

test('a report with both kinds puts the care first, then the news, before the themes', () => {
  const words = 'Spit nuovi sul primo tiro. Una presa si è rotta sul secondo.'
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({ flags: [
      flag('novita', 'Spit nuovi', 'Spit nuovi sul primo tiro.'),
      flag('attenzione', 'Presa rotta', 'Una presa si è rotta sul secondo.'),
    ] }),
  })).document

  assert.deepEqual([...doc.querySelectorAll('.slip__tags .slip__change')].map(t => t.getAttribute('title')), ['Attenzione', 'Novità'])
})

test('words are escaped around the mark, never passed through as markup', () => {
  const words = '<b>ciao</b> chiodi nuovi sul tiro 3 & altro'
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1', words })],
    synthesis: reading({ flags: [flag('novita', 'Chiodi nuovi', 'chiodi nuovi sul tiro 3')] }),
  })).document
  assert.equal(countOf(doc, '.slip__words b'), 0)
  assert.equal(doc.querySelector('.slip__words')?.textContent, words)
})

// The withdraw control moved here from the conditions card, which no longer
// quotes anyone. Counted, never compared to null (see CLAUDE.md).
const forms = (doc: Document) => doc.querySelectorAll('form.ritira').length

test('the author is offered a way to withdraw their own report, signed with the token', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g7' })],
    viewer: { id: 'a1', displayName: 'vale74' } as never, csrf: 'tok',
  })).document
  assert.equal(forms(doc), 1)
  assert.equal(doc.querySelector('form.ritira')!.getAttribute('action'), '/gita/g7/ritira')
  assert.equal(doc.querySelector('form.ritira input[name=csrf]')!.getAttribute('value'), 'tok')
})

test('nobody else is offered it, nor a reader without a token, nor an imported report', () => {
  const page = (o: object) => parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({})], ...o })).document
  assert.equal(forms(page({ viewer: { id: 'a2', displayName: 'x' }, csrf: 'tok' })), 0, 'a stranger')
  assert.equal(forms(page({})), 0, 'signed out')
  assert.equal(forms(page({ viewer: { id: 'a1', displayName: 'vale74' } })), 0, 'no token to sign with')
  assert.equal(forms(parseHTML(giteListPage({ itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ accountId: null, authorName: null })], viewer: { id: 'a1', displayName: 'v' } as never, csrf: 'tok',
  })).document), 0, 'imported')
})

// --- Every theme above the reports, and picking one -----------------------

const indexed = (theme?: string) => parseHTML(giteListPage({
  itineraryId: 'balma', itineraryName: 'Balma Scura',
  gite: [gita({ id: 'g1' }), gita({ id: 'g2' }), gita({ id: 'g3' })],
  synthesis: reading({ themes: [
    { label: 'Tiri brevi', count: 2, voices: 2, reportIds: ['g2', 'g3'] },
    // Four reports in the reading, three of them still here: counted as three.
    { label: 'Chiodatura curata', count: 4, voices: 4, reportIds: ['g1', 'g2', 'g3', 'gone'] },
    { label: 'Ortiche alla base', count: 1, voices: 1, reportIds: ['g3'] },
    { label: 'Solo ritirata', count: 2, voices: 2, reportIds: ['gone'] },
  ] }),
  theme,
})).document

test('every theme is listed above the reports, the shared ones counted, most reports first', () => {
  const doc = indexed()
  const rows = [...doc.querySelectorAll('.tidx__l a')]
  assert.deepEqual(rows.map(a => a.querySelector('span')?.textContent), ['Chiodatura curata', 'Tiri brevi'])
  assert.deepEqual(rows.map(a => a.querySelector('b')?.textContent), ['3', '2'], 'counted over the reports on the page')
  assert.equal(rows[1]?.getAttribute('href'), '/itinerario/balma/relazioni?tema=Tiri%20brevi')
  assert.equal(countOf(doc, '.tidx__filter'), 0, 'nothing picked, nothing filtered')
  assert.equal(countOf(doc, '.slip'), 3)
})

test('a theme one person raised is not in the index: it shows on its own report', () => {
  const doc = indexed()
  const labels = [...doc.querySelectorAll('.tidx a')].map(a => a.textContent)
  assert.ok(!labels.includes('Ortiche alla base'))
  assert.equal(countOf(doc, '.tidx__lone'), 0, 'and no line counts them')
  assert.equal(doc.querySelector('#relazione-g3 .slip__tag--lone')?.textContent, 'Ortiche alla base')
})

test('a theme whose reports have all been withdrawn is not listed', () => {
  const labels = [...indexed().querySelectorAll('.tidx a')].map(a => a.textContent)
  assert.ok(!labels.some(l => l?.includes('Solo ritirata')))
})

test('picking a theme shows only its reports and lights its name, with no line above them', () => {
  const doc = indexed('Tiri brevi')
  assert.deepEqual([...doc.querySelectorAll('.slip')].map(s => s.id), ['relazione-g2', 'relazione-g3'])
  assert.equal(countOf(doc, '.tidx__filter'), 0, 'no line repeats the count: the lit name is the way back')
  assert.equal(doc.querySelector('.tidx__l a.on span')?.textContent, 'Tiri brevi')
  assert.equal(doc.querySelector('.tidx__l a.on')?.getAttribute('aria-current'), 'true')
  assert.deepEqual([...doc.querySelectorAll('.slip__theme--on')].map(e => e.textContent), ['Tiri brevi', 'Tiri brevi'],
    'and it is underlined in each slip that names it')
})

test('an uncounted theme still filters by its address, though the index does not list it', () => {
  const doc = indexed('Ortiche alla base')
  assert.deepEqual([...doc.querySelectorAll('.slip')].map(s => s.id), ['relazione-g3'])
})

test('the picked name, pressed again, undoes the filter, and its cross says so', () => {
  const on = indexed('Tiri brevi').querySelector('.tidx__l a.on')
  assert.equal(on?.getAttribute('href'), '/itinerario/balma/relazioni')
  assert.equal(on?.getAttribute('title'), 'Togli il filtro')
  assert.equal(on?.querySelector('.tidx__x')?.textContent, '×')
  const change = withChanges('Caduta di pietre').querySelector('.tidx .sum__g a.on')
  assert.equal(change?.getAttribute('href'), '/itinerario/balma/relazioni')
})

test('a theme the reading does not have shows every report, unfiltered', () => {
  const doc = indexed('Non esiste')
  assert.equal(countOf(doc, '.slip'), 3)
  assert.equal(countOf(doc, '.tidx__filter'), 0)
  assert.equal(countOf(doc, '.tidx a.on'), 0)
})

test('with no synthesis there is no index', () => {
  const doc = parseHTML(giteListPage({ itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({})] })).document
  assert.equal(countOf(doc, '.tidx'), 0)
})

// --- Attenzione and Novità in the index ------------------------------------

const withChanges = (change?: string, readingNo = 2) => parseHTML(giteListPage({
  itineraryId: 'balma', itineraryName: 'Balma Scura',
  gite: [gita({ id: 'g1', observedAt: '2026-10-14' }), gita({ id: 'g2', observedAt: '2026-06-09' }), gita({ id: 'g3', observedAt: '2025-05-03' })],
  synthesis: { ...reading({ themes: [] }), reading: readingNo, flags: [
    { label: 'Base ripulita', kind: 'novita', reportIds: ['g2'], quotes: {} },
    { label: 'Caduta di pietre', kind: 'attenzione', reportIds: ['g3', 'g1', 'gone'], quotes: {} },
    { label: 'Nuovi tiri', kind: 'novita', reportIds: ['g1'], quotes: {} },
    { label: 'Catena nuova', kind: 'novita', reportIds: ['g3'], quotes: {} },
    { label: 'Spit nuovi', kind: 'novita', reportIds: ['g2'], quotes: {} },
  ] },
  change,
})).document

test('the index names the changes side by side, care then news, three of each in view, the rest folded', () => {
  const doc = withChanges()
  assert.deepEqual([...doc.querySelectorAll('.tidx__chg > .sum__g')].map(g => g.className), ['sum__g sum__g--attenzione', 'sum__g sum__g--novita'])
  const rows = (kind: string) => [...doc.querySelectorAll(`.tidx .sum__g--${kind} > div:not(.sum__gh)`)]
  assert.deepEqual(rows('attenzione').map(r => [r.querySelector('b')?.textContent, r.querySelector('a')?.textContent, r.querySelector('small')?.textContent]),
    [['2', 'Caduta di pietre', '14 ott 2026']], 'counted over the reports on the page, dated by the latest')
  assert.deepEqual(rows('novita').map(r => r.querySelector('a')?.textContent), ['Nuovi tiri', 'Base ripulita', 'Spit nuovi'],
    'the three most recently said')
  const fold = doc.querySelector('.sum__g--novita details.tidx__more')
  assert.equal(fold?.querySelector('.tidx__closed')?.textContent, 'Un’altra')
  assert.deepEqual([...(fold?.querySelectorAll('a') ?? [])].map(a => a.textContent), ['Catena nuova'])
  assert.equal(fold?.hasAttribute('open'), false)
  assert.equal(countOf(doc, '.sum__g--attenzione details'), 0, 'nothing to fold under three')
  assert.equal(rows('attenzione')[0]?.querySelector('a')?.getAttribute('href'), '/itinerario/balma/relazioni?cambio=Caduta%20di%20pietre')
})

test('picking a change shows only its reports and underlines it where each names it', () => {
  const doc = withChanges('Caduta di pietre')
  assert.deepEqual([...doc.querySelectorAll('.slip')].map(s => s.id), ['relazione-g1', 'relazione-g3'])
  assert.equal(doc.querySelector('.tidx .sum__g a.on')?.firstChild?.textContent, 'Caduta di pietre')
  assert.deepEqual([...doc.querySelectorAll('.slip__change--on')].map(e => e.textContent), ['Caduta di pietre', 'Caduta di pietre'])
})

test('a folded change, once picked, opens its fold', () => {
  assert.equal(withChanges('Catena nuova').querySelector('.sum__g--novita details')?.hasAttribute('open'), true)
})

test('a change from an earlier reading, named by its sentence, is not in the index', () => {
  const doc = withChanges(undefined, 1)
  assert.equal(countOf(doc, '.tidx a'), 0)
  assert.equal(countOf(doc, '.tidx p.tidx__wait'), 1, 'the box says nothing is shared yet')
})

test('a theme and a change of the same name are told apart by what picked them', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite: [gita({ id: 'g1' }), gita({ id: 'g2' })],
    synthesis: { ...reading({ themes: [{ label: 'Spit nuovi', count: 2, voices: 2, reportIds: ['g1', 'g2'] }] }), reading: 2,
      flags: [{ label: 'Spit nuovi', kind: 'novita', reportIds: ['g2'], quotes: {} }] },
    change: 'Spit nuovi',
  })).document
  assert.deepEqual([...doc.querySelectorAll('.slip')].map(s => s.id), ['relazione-g2'])
  assert.equal(countOf(doc, '.tidx__l a.on'), 0)
})

// --- A long index: ten in view, the rest folded ---------------------------

const longIndex = (theme?: string) => {
  const gite = Array.from({ length: 14 }, (_, i) => gita({ id: `g${i}` }))
  // Fourteen shared themes, the first counted in fourteen reports, the last in one... two voices each at least.
  const themes = Array.from({ length: 14 }, (_, i) => ({
    label: `Tema ${i + 1}`, count: 14 - i, voices: 2, reportIds: gite.slice(0, 14 - i).map(g => g.id),
  }))
  const lone = Array.from({ length: 3 }, (_, i) => ({ label: `Solo ${i + 1}`, count: 1, voices: 1, reportIds: [`g${i}`] }))
  return parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura', gite,
    synthesis: reading({ themes: [...themes, ...lone] }), theme,
  })).document
}

test('past ten shared themes, the rest fold away under a line that says how many', () => {
  const doc = longIndex()
  assert.equal(doc.querySelectorAll('.tidx > .tidx__l a').length, 10, 'the ten most reported in view')
  assert.equal(doc.querySelector('.tidx > .tidx__l a span')?.textContent, 'Tema 1')
  assert.equal(doc.querySelectorAll('.tidx__more .tidx__l a').length, 4)
  assert.equal(doc.querySelector('.tidx__more summary .tidx__closed')?.textContent, 'Altri 4 temi condivisi')
  assert.equal(doc.querySelector('.tidx__more summary .tidx__open')?.textContent, 'Meno temi')
  assert.equal(doc.querySelector('.tidx__more')?.hasAttribute('open'), false)
})

test('ten or fewer shared themes, nothing to fold', () => {
  assert.equal(countOf(indexed(), '.tidx__more'), 0)
})

test('a fold holding the picked theme is open, so what filters the page is in view', () => {
  assert.equal(longIndex('Tema 12').querySelector('.tidx__more')?.hasAttribute('open'), true)
  assert.equal(longIndex('Tema 2').querySelector('.tidx__more')?.hasAttribute('open'), false)
})

test('a reading with only one-voice themes and no changes says so in the index box, rather than leaving it empty', () => {
  const page = (theme?: string) => parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g1' }), gita({ id: 'g2' })],
    synthesis: reading({ themes: [
      { label: 'Ortiche alla base', count: 1, voices: 1, reportIds: ['g1'] },
      { label: 'Parcheggio pieno', count: 1, voices: 1, reportIds: ['g2'] },
    ] }),
    theme,
  })).document
  assert.equal(countOf(page(), '.tidx'), 1)
  assert.equal(page().querySelector('.tidx p.tidx__wait')?.textContent, 'Nessun tema è ancora condiviso da più persone.')
  assert.equal(countOf(page(), '.tidx a'), 0, 'and lists nothing')
  assert.equal(page().querySelector('#relazione-g1 .slip__tag--lone')?.textContent, 'Ortiche alla base',
    'the point still shows on its own report')
  const picked = page('Ortiche alla base')
  assert.deepEqual([...picked.querySelectorAll('.slip')].map(s => s.id), ['relazione-g1'], 'and its address still filters')
})

const photo = (id: string, gitaId: string, caption: string | null = null): PhotoRow => ({
  id, position: 0, caption, mime: 'image/jpeg', gitaId, authorName: 'vale74', observedAt: '2026-09-09', credit: null,
})

test('a report shows its own photos under its words, as one block; a report with none shows no block', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g1' }), gita({ id: 'g2' })],
    photos: [photo('p1', 'g1', 'Il 6b+'), photo('p2', 'g1')],
  })).document

  assert.equal(countOf(doc, '#relazione-g1 .slip__words + .mo a.mo__t'), 2)
  assert.equal(countOf(doc, '#relazione-g2 .mo'), 0)
  assert.equal(doc.querySelector('#relazione-g1 .mo__chip')?.textContent, 'Il 6b+', 'a caption sits on its photo')
  assert.equal(doc.querySelector('#relazione-g1 .mo a')?.getAttribute('href'), '/itinerario/balma/foto#lb-p1')
})

test('past five photos, the fifth counts the rest and the others wait hidden for the viewer', () => {
  const doc = parseHTML(giteListPage({
    itineraryId: 'balma', itineraryName: 'Balma Scura',
    gite: [gita({ id: 'g1' })],
    photos: Array.from({ length: 8 }, (_, i) => photo(`p${i}`, 'g1')),
  })).document

  assert.ok(doc.querySelector('.mo')?.classList.contains('mo--5'))
  assert.equal(countOf(doc, '.mo a.mo__t:not([hidden])'), 5)
  assert.equal(countOf(doc, '.mo a.mo__t[hidden]'), 3)
  assert.equal(doc.querySelector('.mo a.mo__t:nth-child(5) .mo__more')?.textContent, '+3')
})
