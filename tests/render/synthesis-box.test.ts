import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { reportsBox, type ReportsBoxOpts } from '../../src/render/synthesis-box.ts'
import { render } from '../../src/render/html.ts'
import type { SynthesisRow } from '../../src/db/synthesis.ts'

const countOf = (doc: Document, selector: string) => doc.querySelectorAll(selector).length
const text = (doc: Document, selector: string) => doc.querySelector(selector)?.textContent?.trim() ?? null

const row = (themes: SynthesisRow['themes']): SynthesisRow => ({
  itineraryId: 'i1', generatedAt: '2026-09-17T10:00:00.000Z', reportCount: 12, themes, flags: [], reading: 2, readIds: [],
})

function box(synthesis: SynthesisRow | null, opts: ReportsBoxOpts): Document {
  return parseHTML(`<div>${render(reportsBox(synthesis, opts))}</div>`).document
}

test('there is no lead paragraph: it read the list aloud', () => {
  const doc = box(row([{ label: 'Primo tema', count: 5, reportIds: [] }, { label: 'Secondo tema', count: 4, reportIds: [] }]),
    { reportCount: 12 })

  assert.equal(countOf(doc, '.lead'), 0)
  assert.equal(countOf(doc, '.sum p'), 0, 'with a list, nothing in the box is prose')
  assert.equal(countOf(doc, '.sum__f'), 0, 'and there is no footer')
})

test('the list shows every theme as count then label', () => {
  const doc = box(row([
    { label: 'Uno', count: 5, reportIds: [] }, { label: 'Due', count: 4, reportIds: [] }, { label: 'Tre', count: 3, reportIds: [] },
    { label: 'Quattro', count: 2, reportIds: [] }, { label: 'Cinque', count: 2, reportIds: [] },
  ]), { reportCount: 12 })

  assert.equal(countOf(doc, '.sum__l > div'), 5)
  const item = doc.querySelector('.sum__l > div')!
  assert.equal(item.querySelector('b')?.textContent, '5')
  assert.equal(item.querySelector('span')?.textContent, 'Uno')
})

test('with themes, the total is the synthesis’s own, said once, large, beside the list', () => {
  // Twelve were read; a thirteenth was filed since. The counts are out of twelve.
  const doc = box(row([{ label: 'X', count: 3, reportIds: [] }]), { reportCount: 13 })

  assert.equal(text(doc, '.sum__top b'), '12')
  assert.equal(text(doc, '.sum__now > span'), 'relazioni in tutto')
})

test('under the count, the last report’s calendar date, then how long ago', () => {
  const doc = box(row([{ label: 'X', count: 3, reportIds: [] }]), {
    reportCount: 12, lastReportAt: '2026-09-15', now: new Date('2026-09-17T10:00:00.000Z'),
  })

  // Exact match, not a substring check: formatAgo already returns "due giorni
  // fa" complete with its own "fa" — a loose .includes() is exactly what let a
  // duplicated "fa fa" ship unnoticed once before.
  assert.equal(text(doc, '.sum__last em'), 'L’ultima')
  assert.equal(text(doc, '.sum__last strong'), '15 set 2026')
  assert.equal(text(doc, '.sum__last small'), 'due giorni fa')
  assert.equal(text(doc, '.sum__h'), 'Citatoda quante relazioni', 'the numbers carry a column head')
})

test('a last report from today reads naturally, not "oggi fa"', () => {
  const doc = box(row([{ label: 'X', count: 3, reportIds: [] }]), {
    reportCount: 12, lastReportAt: '2026-09-17', now: new Date('2026-09-17T10:00:00.000Z'),
  })
  assert.equal(text(doc, '.sum__last small'), 'oggi')
})

test('past a year the date keeps its months', () => {
  const doc = box(null, {
    reportCount: 2, lastReportAt: '2025-08-10', now: new Date('2026-11-16T10:00:00.000Z'),
  })
  assert.equal(text(doc, '.sum__last strong'), '10 ago 2025')
  assert.equal(text(doc, '.sum__last small'), 'un anno e tre mesi fa')
})

test('with no date, the total stands alone', () => {
  const doc = box(row([{ label: 'X', count: 3, reportIds: [] }]), { reportCount: 12 })
  assert.equal(countOf(doc, '.sum__d'), 0)
  assert.equal(text(doc, '.sum__top b'), '12')
})

test('below the floor: the same box, a sentence where the list will be, the route’s total', () => {
  const doc = box(null, {
    reportCount: 2, lastReportAt: '2026-09-12', now: new Date('2026-11-16T10:00:00.000Z'),
  })

  assert.equal(countOf(doc, '.sum__l'), 0)
  assert.equal(text(doc, '.sum > .sum__wait'),
    'I temi che ritornano compaiono qui da cinque relazioni in su.')
  assert.equal(text(doc, '.sum__top b'), '2')
  assert.equal(text(doc, '.sum__last small'), 'due mesi fa')
  assert.equal(countOf(doc, '.sum__h'), 0, 'no column head without a list')
})

test('one report is not "the last", and its total is singular', () => {
  const doc = box(null, {
    reportCount: 1, lastReportAt: '2026-09-12', now: new Date('2026-11-16T10:00:00.000Z'),
  })

  assert.equal(text(doc, '.sum__last em'), 'L’unica')
  assert.equal(text(doc, '.sum__last strong'), '12 set 2026')
  assert.equal(text(doc, '.sum__now > span'), 'relazione in tutto')
})

test('enough reports but no synthesis yet says so, rather than promising five', () => {
  const doc = box(null, { reportCount: 6 })
  assert.equal(text(doc, '.sum__wait'), 'I temi che ritornano non sono ancora stati raccolti.')
  assert.equal(countOf(doc, '.sum__d'), 0, 'no date, nothing under the count')
})

test('a synthesis that found nothing shared says that, as a result', () => {
  const doc = box(row([]), { reportCount: 12 })
  assert.equal(text(doc, '.sum__wait'), 'Nessun tema è ancora condiviso da più persone.')
  assert.equal(text(doc, '.sum__top b'), '12')
})

test('the list holds only themes two people share, the five most reported, never a lone one', () => {
  const t = (label: string, count: number, voices: number) => ({ label, count, voices, reportIds: [] })
  const doc = box(row([
    t('Solo mio', 9, 1),                 // nine reports, one climber: never listed
    t('A', 2, 2), t('B', 7, 3), t('C', 4, 2), t('D', 3, 3), t('E', 6, 2), t('F', 5, 4),
  ]), { reportCount: 12 })

  assert.deepEqual([...doc.querySelectorAll('.sum__l > div')].map(d => d.textContent),
    ['7B', '6E', '5F', '4C', '3D'])
})

test('with only lone themes, the box says nothing returns', () => {
  const doc = box(row([{ label: 'Solo mio', count: 3, voices: 1, reportIds: [] }]), { reportCount: 12 })
  assert.equal(countOf(doc, '.sum__l'), 0)
  assert.equal(text(doc, '.sum__wait'), 'Nessun tema è ancora condiviso da più persone.')
})

// --- What changed at the place, under the themes --------------------------

const flag = (label: string, kind: 'attenzione' | 'novita', reportIds: string[]) =>
  ({ label, kind, reportIds, quotes: Object.fromEntries(reportIds.map(id => [id, `${label}.`])) })

const withFlags = (flags: SynthesisRow['flags'], themes: SynthesisRow['themes'] = [{ label: 'X', count: 3, reportIds: [] }]): SynthesisRow =>
  ({ ...row(themes), flags })

const dates = new Map([
  ['r1', '2026-11-02'], ['r2', '2026-10-14'], ['r3', '2026-06-09'], ['r4', '2025-05-03'], ['r5', '2025-04-18'],
])

test('a change is its short name, with how many reports say it and when it was last said', () => {
  // Three reports of falling stones, on three days, are one line.
  const doc = box(withFlags([flag('Caduta di pietre', 'attenzione', ['r4', 'r1', 'r2'])]),
    { reportCount: 12, reportDates: dates, itineraryId: 'i1' })

  assert.equal(countOf(doc, '.sum__g--attenzione > div:not(.sum__gh)'), 1)
  const line = doc.querySelector('.sum__g--attenzione > div:not(.sum__gh)')!
  assert.equal(line.querySelector('b')?.textContent, '3')
  assert.equal(line.querySelector('span')?.textContent, 'Caduta di pietre')
  assert.equal(line.querySelector('small')?.textContent, '2 nov 2026', 'dated by the latest report')
  assert.equal(line.querySelectorAll('a').length, 0, 'a name, not a link')
  assert.equal(text(doc, '.sum__g--attenzione .sum__gh'), 'Attenzioneultima volta')
})

test('care comes before news, each newest first, three at most and the rest said', () => {
  const doc = box(withFlags([
    flag('Base ripulita', 'novita', ['r3']),
    flag('Scaglia caduta', 'attenzione', ['r4']),
    flag('Nuovi tiri', 'novita', ['r2']),
    flag('Prese staccate', 'attenzione', ['r2']),
    flag('Prese rimosse', 'novita', ['r5']),
    flag('Spit nuovi', 'novita', ['r1']),
    flag('Catena nuova', 'novita', ['r4']),
  ]), { reportCount: 12, reportDates: dates })

  const groups = [...doc.querySelectorAll('.sum__g')].map(g => g.className)
  assert.deepEqual(groups, ['sum__g sum__g--attenzione', 'sum__g sum__g--novita'])
  const names = (kind: string) => [...doc.querySelectorAll(`.sum__g--${kind} > div:not(.sum__gh) span`)].map(s => s.textContent)
  assert.deepEqual(names('attenzione'), ['Prese staccate', 'Scaglia caduta'])
  assert.deepEqual(names('novita'), ['Spit nuovi', 'Nuovi tiri', 'Base ripulita'])
  assert.equal(text(doc, '.sum__g--novita .sum__more'), 'E altre 2 nelle relazioni')
  assert.equal(countOf(doc, '.sum__g--attenzione .sum__more'), 0)
})

test('a report withdrawn since the reading is not counted, and a change with none left goes', () => {
  const doc = box(withFlags([
    flag('Prese staccate', 'attenzione', ['r2', 'gone']),
    flag('Sentiero chiuso', 'attenzione', ['gone']),
  ]), { reportCount: 12, reportDates: dates })

  assert.equal(countOf(doc, '.sum__g--attenzione > div:not(.sum__gh)'), 1)
  assert.equal(text(doc, '.sum__g--attenzione > div:not(.sum__gh) b'), '1')
})

test('changes show below the theme floor too: one report can say a chain is gone', () => {
  const doc = box(withFlags([flag('Catena divelta', 'attenzione', ['r1'])], []),
    { reportCount: 1, reportDates: dates })

  assert.equal(countOf(doc, '.sum__wait'), 1, 'the sentence that waits for themes stays')
  assert.equal(text(doc, '.sum__g--attenzione > div:not(.sum__gh) span'), 'Catena divelta')
  assert.equal(countOf(doc, '.sum__g a'), 0, 'with no route given, the name is plain text')
})

test('no changes, no groups: the box is as it was', () => {
  const doc = box(withFlags([]), { reportCount: 12, reportDates: dates })
  assert.equal(countOf(doc, '.sum__g'), 0)
  assert.equal(countOf(doc, '.sum__col'), 0)
})

test('changes from an earlier reading, which named none, wait for the next one', () => {
  const doc = box({ ...withFlags([flag('Nel settore alto si è staccata una scaglia', 'attenzione', ['r1'])]), reading: 1 },
    { reportCount: 12, reportDates: dates })
  assert.equal(countOf(doc, '.sum__g'), 0)
})

test('the way in to every report is at the top of the box, by the route\'s count', () => {
  const doc = box(row([{ label: 'X', count: 3, reportIds: [] }]), { reportCount: 40, itineraryId: 'i1' })
  const go = doc.querySelector('.sum__top > a.sum__go')
  assert.equal(go?.getAttribute('href'), '/itinerario/i1/relazioni')
  assert.equal(go?.textContent, 'Leggile tutte')
  assert.equal(go?.getAttribute('aria-label'), 'Leggi tutte le 40 relazioni')
  assert.equal(countOf(doc, 'a'), 1, 'and it is the only link in the box')
})

test('without a route there is nowhere to go, so no button', () => {
  assert.equal(countOf(box(null, { reportCount: 3 }), 'a.sum__go'), 0)
})
