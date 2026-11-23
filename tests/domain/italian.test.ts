import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatAge, formatDateWithArticle, formatRelativeDays, listInItalian,
} from '../../src/domain/italian.ts'

test('a plain list takes commas and "e" before the last', () => {
  assert.equal(listInItalian(['Basso', 'Centrale', 'Scuola']), 'Basso, Centrale e Scuola')
  assert.equal(listInItalian(['Basso', 'Scuola']), 'Basso e Scuola')
  assert.equal(listInItalian(['Basso']), 'Basso')
})

test('when an item contains a comma the list separates on semicolons instead', () => {
  // Route names in this archive are feature-then-route: "Monviso, Cresta Est".
  // Comma-separating a list of them would read as twice as many routes.
  assert.equal(
    listInItalian(['Sperone del Lago, Via Nord', 'Cresta del Colletto', 'Canale dei Camosci']),
    'Sperone del Lago, Via Nord; Cresta del Colletto; e Canale dei Camosci')
})

test('a date reads as a distance in days, in the words Italian uses for small numbers', () => {
  const now = new Date('2026-09-11T10:00:00Z')

  assert.equal(formatRelativeDays('2026-09-11', now), 'oggi')
  assert.equal(formatRelativeDays('2026-09-10', now), 'ieri')
  assert.equal(formatRelativeDays('2026-09-09', now), 'due giorni fa',
    'Intl says "l’altro ieri" here; the specimen and this archive say "due giorni fa"')
  assert.equal(formatRelativeDays('2026-09-02', now), 'nove giorni fa')
  assert.equal(formatRelativeDays('2026-09-01', now), '10 giorni fa',
    'ten and above stay as figures, as inWords has it')
})

test('it counts whole UTC days, so "ieri" is the calendar day before', () => {
  // Late yesterday to early today is under 24 hours and still "ieri"; the same
  // day at any hour is "oggi". Every date this project stores is a UTC day.
  assert.equal(formatRelativeDays('2026-09-10T23:30:00Z', new Date('2026-09-11T00:30:00Z')), 'ieri')
  assert.equal(formatRelativeDays('2026-09-11T00:00:00Z', new Date('2026-09-11T23:59:00Z')), 'oggi')
})

test('it counts across a month boundary', () => {
  assert.equal(formatRelativeDays('2026-08-31', new Date('2026-09-02T09:00:00Z')), 'due giorni fa')
  assert.equal(formatRelativeDays('2026-02-26', new Date('2026-03-01T09:00:00Z')), 'tre giorni fa')
})

test('a date in the future reads as today rather than counting backwards', () => {
  // Validation should prevent it; this function cannot assume it did.
  assert.equal(formatRelativeDays('2026-09-20', new Date('2026-09-11T10:00:00Z')), 'oggi')
})

// `datata` has to say how old the archive is, and "126 giorni fa" is the wrong
// register for something four months old: nobody counts a season in days. The
// specimen reads "L’ultima osservazione ha quattro mesi."
test('an age reads in the unit a climber would use, not always in days', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  assert.equal(formatAge('2026-05-12', now), 'quattro mesi', 'the specimen’s own words')
  assert.equal(formatAge('2026-09-09', now), 'sei giorni')
  assert.equal(formatAge('2026-09-14', now), 'un giorno')
})

test('it changes unit on whole months, and keeps writing small numbers out', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  assert.equal(formatAge('2026-08-15', now), 'un mese', 'a whole month to the day')
  assert.equal(formatAge('2026-08-16', now), '30 giorni',
    'a day short of a month is still days, and ten and above stay as figures')
  assert.equal(formatAge('2025-10-15', now), '11 mesi')
})

test('a year of silence says a year, not fourteen months', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  assert.equal(formatAge('2025-09-15', now), 'un anno')
  assert.equal(formatAge('2025-07-15', now), 'un anno', 'fourteen months is a year to a reader')
  assert.equal(formatAge('2024-08-15', now), 'due anni')
})

test('an age that has not happened yet is less than a day, not a negative one', () => {
  // Validation should prevent it; this function cannot assume it did.
  assert.equal(formatAge('2026-09-20', new Date('2026-09-15T12:00:00Z')), 'meno di un giorno')
})

test('the article before a date elides where the day begins with a vowel', () => {
  // Otto, undici, diciotto. The first of the month is read "primo" and takes
  // the plain article like any consonant.
  assert.equal(formatDateWithArticle('a', '2026-09-14'), 'al 14 settembre')
  assert.equal(formatDateWithArticle('a', '2026-09-11'), 'all’11 settembre')
  assert.equal(formatDateWithArticle('a', '2026-09-08'), 'all’8 settembre')
  assert.equal(formatDateWithArticle('a', '2026-09-01'), 'al 1 settembre')

  assert.equal(formatDateWithArticle('da', '2026-09-14'), 'dal 14 settembre')
  assert.equal(formatDateWithArticle('da', '2026-09-18'), 'dall’18 settembre')
})

test('a date nothing can read says so, rather than saying NaN', () => {
  // Not reachable from the validated write path. This is a renderer, and a
  // stored value nobody can parse should not take a page down — nor should it
  // print "NaN giorni fa", which reads as a number.
  const now = new Date('2026-09-15T12:00:00.000Z')

  assert.equal(formatRelativeDays('non una data', now), 'data sconosciuta')
  assert.equal(formatRelativeDays('', now), 'data sconosciuta')
})

test('when something was reads in days within a month, then in months and years', async () => {
  const { formatAgo } = await import('../../src/domain/italian.ts')
  const now = new Date('2026-11-16T12:00:00Z')
  assert.equal(formatAgo('2026-11-15', now), 'ieri')
  assert.match(formatAgo('2026-10-20', now), /giorni fa$/, 'twenty-seven days is still days')
  assert.equal(formatAgo('2026-04-06', now), 'sette mesi fa')
  assert.equal(formatAgo('2021-05-10', now), 'cinque anni e sei mesi fa')
})

test('formatAgo past a year keeps the months, and a whole year reads alone', async () => {
  const { formatAgo } = await import('../../src/domain/italian.ts')
  const now = new Date('2026-11-16T12:00:00Z')
  assert.equal(formatAgo('2025-11-16', now), 'un anno fa')
  assert.equal(formatAgo('2025-10-16', now), 'un anno e un mese fa')
  assert.equal(formatAgo('2025-08-10', now), 'un anno e tre mesi fa')
  assert.equal(formatAgo('2025-11-17', now), '11 mesi fa', 'the 17th to the 16th is not yet a year')
  assert.equal(formatAgo('2024-11-16', now), 'due anni fa')
  assert.equal(formatAgo('2024-10-01', now), 'due anni e un mese fa')
})
