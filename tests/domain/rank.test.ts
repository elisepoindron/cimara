import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rank, type Candidate } from '../../src/domain/find/rank.ts'
import type { Constraint } from '../../src/domain/find/constraints.ts'

const NOW = new Date('2026-09-15T12:00:00.000Z')

/** Recently written about: `n` reports inside the activity's window, the newest yesterday. */
const reported = (n: number) => ({ reports: n, recent: n, lastReportAt: '2026-09-14' })

const at = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'x', name: 'Prova', lat: 44.6, lon: 7.1,
  gradeMin: 6, gradeMax: 6, gradeScale: 'alpine',
  reports: 0, recent: 0, lastReportAt: null, ...over,
})

const TORINO = { kind: 'near' as const, placeId: 'p1', placeName: 'Torino', withinKm: 60 }
const CENTRE = { lat: 45.0703, lon: 7.6869 }   // Torino, which the parser cannot know
const upToAD: Constraint = { kind: 'grade', scale: 'alpine', min: 0, max: 6, written: 'fino a AD' }

const order = (cs: readonly Candidate[], k: readonly Constraint[] = []) =>
  rank(cs, k, { now: NOW, centre: CENTRE }).map(r => r.candidate.id)

test('a route written about recently outranks one nobody has reported on', () => {
  assert.deepEqual(order([at({ id: 'u' }), at({ id: 'r', ...reported(1) })]), ['r', 'u'])
})

test('several recent reports outrank one, up to three', () => {
  assert.deepEqual(order([at({ id: 'one', ...reported(1) }), at({ id: 'many', ...reported(3) })]), ['many', 'one'])
  const [three, ten] = [3, 10].map(n => rank([at(reported(n))], [], { now: NOW })[0]!.score)
  assert.equal(ten, three, 'past three, more reports add reading, not rank')
})

test('reports outside the window count for nothing but their date', () => {
  const old = at({ id: 'old', reports: 12, recent: 0, lastReportAt: '2026-09-14' })
  const fresh = at({ id: 'fresh', ...reported(1) })
  assert.deepEqual(order([old, fresh]), ['fresh', 'old'])
})

test('the reason says people went, never what they found', () => {
  const [one] = rank([at(reported(1))], [], { now: NOW })
  const [many] = rank([at(reported(3))], [], { now: NOW })
  assert.match(one!.why, /da poco/, 'one report yesterday: it was told recently')
  assert.match(many!.why, /in diversi ci sono stati da poco/)
  assert.doesNotMatch(one!.why + many!.why, /buon|ottim|condizion|osservazion/)
})

test('the nearest of the group wins, and the reason says so', () => {
  const near = at({ id: 'near', lat: 45.02, lon: 7.65 })   // just outside Turin
  const far = at({ id: 'far', lat: 44.20, lon: 7.05 })

  const [first] = rank([far, near], [TORINO], { now: NOW, centre: CENTRE })
  assert.equal(first!.candidate.id, 'near')
  assert.match(first!.why, /vicino/, 'the design says "il più vicino del gruppo"')
})

test('a route inside the grade range outranks one outside it', () => {
  const inside = at({ id: 'in', gradeMin: 5, gradeMax: 6 })
  const outside = at({ id: 'out', gradeMin: 9, gradeMax: 10 })

  assert.deepEqual(order([outside, inside], [upToAD]), ['in', 'out'])
})

test('a route kept in spite of a soft constraint says that, not why it won', () => {
  const overGrade = at({ id: 'hard', gradeMin: 8, gradeMax: 8, ...reported(3) })

  const [only] = rank([overGrade], [upToAD], { now: NOW })
  assert.match(only!.why, /limite/,
    'being kept in spite of something is the more useful thing to know')
})

test('a grade on another scale is not compared at all', () => {
  // A sport constraint against an alpine route: the ordinals are integers on two
  // different scales and comparing them would be arithmetic about nothing.
  const sportOnAlpine: Constraint =
    { kind: 'grade', scale: 'sport', min: 7, max: 12, written: 'dal 6a al 7b' }
  const alpine = at({ id: 'a', gradeScale: 'alpine', gradeMin: 6, gradeMax: 6 })

  const [only] = rank([alpine], [sportOnAlpine], { now: NOW })
  assert.equal(only!.candidate.id, 'a', 'it is not dropped — dropping is SQL’s job')
  assert.doesNotMatch(only!.why, /limite/,
    'and it is not accused of being at the limit of a scale it is not on')
})

test('a route reported this week outranks one reported in July', () => {
  const fresh = at({ id: 'fresh', lastReportAt: '2026-09-14', reports: 1 })
  const stale = at({ id: 'stale', lastReportAt: '2026-07-14', reports: 1 })

  assert.deepEqual(order([stale, fresh]), ['fresh', 'stale'])
})

test('two routes that tie break on their names, so the order is stated', () => {
  const b = at({ id: 'b', name: 'Bricco' })
  const a = at({ id: 'a', name: 'Aiguille' })

  assert.deepEqual(order([b, a]), ['a', 'b'],
    'an arbitrary order is still an order somebody will read meaning into')
})

test('with nothing asked for, the archive still ranks', () => {
  const ranked = rank([at({ id: 'x' }), at({ id: 'y', ...reported(2) })], [],
    { now: NOW })

  assert.equal(ranked.length, 2)
  assert.ok(ranked.every(r => r.why.length > 0), 'every row says why it is where it is')
})

test('a route with no coordinates is ranked, not dropped, when distance is asked for', () => {
  const nowhere = at({ id: 'nowhere', lat: null, lon: null })
  const somewhere = at({ id: 'somewhere', lat: 45.02, lon: 7.65 })

  const ids = order([nowhere, somewhere], [TORINO])
  assert.deepEqual(ids, ['somewhere', 'nowhere'],
    'it cannot score on distance, but it is still a route that matched')
})

test('the score never reaches the reason', () => {
  const [only] = rank([at(reported(2))], [TORINO], { now: NOW, centre: CENTRE })
  assert.doesNotMatch(only!.why, /[0-9]*\.[0-9]/,
    'a number would invite comparing two routes’ scores, which this data cannot support')
})

test('the reason is Italian', () => {
  const [only] = rank([at(reported(2))], [], { now: NOW })
  assert.doesNotMatch(only!.why, /\b(because|report|nearest)\b/i)
})

test('a dry spell needs weather known, and no rain in the window clears it', async () => {
  const { dryFor } = await import('../../src/domain/find/rank.ts')
  assert.equal(dryFor(null, 2), false, 'never measured')
  assert.equal(dryFor({ daysSinceRain: 3 }, 3), true)
  assert.equal(dryFor({ daysSinceRain: 2 }, 3), false)
  assert.equal(dryFor({ daysSinceRain: null }, 7), true, 'no rain anywhere in the window')
})
