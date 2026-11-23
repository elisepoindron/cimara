import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ABSENT, readFact, gradeBoundsOf, resolveFacts, resolveAccessFacts, distributionOf, gradeSpreadOf, FactError, pitchCountMismatch, withMissingFacts, type Part } from '../../src/domain/facts.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import { defineActivity, fact } from '../../src/domain/registry.ts'
import { text, boolean, gradeScale } from '../../src/domain/quantity.ts'

const via = (n: number, grado: string, lunghezza: number, group: string | null = null): Part =>
  ({ id: `v${n}`, group, position: n, fields: { nome: `Via ${n}`, grado, lunghezza } })

// node:assert's `throws` reports pass/fail but never returns the thrown error, so a test
// that needs to inspect it (here, FactError#problems) has to capture it itself.
function captureFactError(fn: () => unknown): FactError {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof FactError, `expected a FactError, got ${String(e)}`)
    return e
  }
  throw new assert.AssertionError({ message: 'expected the callback to throw a FactError' })
}

test('an alpine route resolves its six authored facts in registry order', () => {
  const values = resolveFacts(activityOf('alpinismo'), {
    difficolta: 'AD', dislivello: 2000, partenza: 2020,
    vetta: 3841, esposizione: 'SE', giorni: 2,
  }, [])
  assert.deepEqual(values.map(v => v.def.label.it),
    ['Difficoltà', 'Dislivello', 'Partenza', 'Vetta', 'Esposizione', 'Giorni'])
  assert.deepEqual(values.map(v => v.text),
    ['AD', '2000 m', '2020 m', '3841 m', 'Sud-Est', '2'])
})

test('a crag computes gradi and vie from its vie rather than storing them', () => {
  const parts = [via(1, '6a', 14), via(2, '7c', 34), via(3, '6b+', 20)]
  const values = resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20 }, parts)

  const byId = Object.fromEntries(values.map(v => [v.def.id, v.text]))
  assert.equal(byId.gradi, '6a a 7c', 'the span comes from the hardest and easiest via')
  assert.equal(byId.vie, '3')
  assert.equal(byId.lunghezza, undefined, 'length is each via\'s own, not a crag fact')
  assert.equal(byId.avvicinamento, '20 min')
})

test('an ungraded via counts as a via but not toward gradi or the grade bounds', () => {
  const ungraded: Part = { id: 'v9', group: null, position: 9, fields: { nome: 'Variante', lunghezza: 8 } }
  const parts = [via(1, '6a', 14), via(2, '7a', 20), ungraded]
  const byId = Object.fromEntries(resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780 }, parts).map(v => [v.def.id, v.text]))

  assert.equal(byId.gradi, '6a a 7a')
  assert.equal(byId.vie, '3')
  const sport = gradeScale('sport')
  assert.deepEqual(gradeBoundsOf(activityOf('falesia'), {}, parts),
    { min: sport.ordinal('6a'), max: sport.ordinal('7a') })
})

test('a crag with no vie at all is still an error: gradi is required', () => {
  const err = captureFactError(() => resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20 }, []))
  assert.ok(err.problems.some(p => p.startsWith('gradi:')), err.problems.join('; '))
})

test('every problem is reported at once, not one at a time', () => {
  const err = captureFactError(() => resolveFacts(activityOf('alpinismo'), {
    difficolta: '6a', dislivello: 2000, partenza: 2020,
    vetta: 'alto', esposizione: 'SW', giorni: 2,
  }, []))

  assert.equal(err.problems.length, 3)
  assert.match(err.problems.join('\n'), /difficolta/)
  assert.match(err.problems.join('\n'), /vetta/)
  assert.match(err.problems.join('\n'), /esposizione/)
})

test('a missing authored fact is a problem; a derived fact with no parts is too', () => {
  const missing = captureFactError(() => resolveFacts(activityOf('alpinismo'),
    { difficolta: 'AD', partenza: 2020, vetta: 3841, esposizione: 'SE', giorni: 2 },
    []))
  assert.match(missing.problems[0] ?? '', /dislivello.*missing/i)

  const noParts = captureFactError(() => resolveFacts(activityOf('falesia'),
    { esposizione: 'S', quota_base: 780, avvicinamento: 20 }, []))
  assert.match(noParts.problems.join('\n'), /gradi.*no parts/i)
})

test('an optional fact nobody recorded is absent, not a problem', () => {
  // A twenty-year-old archive holds routes whose grade nobody filled in, and
  // refusing to hold them is a claim about the world that is false.
  const values = resolveFacts(activityOf('alpinismo'),
    { dislivello: 2000, partenza: 2020, vetta: 3841, esposizione: 'SE', giorni: 2 }, [])

  assert.equal(values.some(v => v.def.id === 'difficolta'), false,
    'the facts strip is one item shorter, and says nothing it does not know')
  assert.ok(values.length > 0, 'and everything else still resolved')
})

test('an optional fact that is present and wrong is still a problem', () => {
  // Absent is not the same as unreadable: nobody wrote it, versus somebody
  // wrote something nothing can read.
  const bad = captureFactError(() => resolveFacts(activityOf('alpinismo'),
    { difficolta: 'AD/D', dislivello: 2000, partenza: 2020, vetta: 3841,
      esposizione: 'SE', giorni: 2 }, []))

  assert.match(bad.problems.join('\n'), /difficolta/)
})

test('the grade distribution counts vie per grade, in scale order, with gaps dropped', () => {
  const parts = [via(1, '6a', 14), via(2, '6a', 15), via(3, '7a', 22), via(4, '6b', 18)]
  assert.deepEqual(distributionOf(activityOf('falesia'), parts, 'grado'), [
    { value: '6a', n: 2 },
    { value: '6b', n: 1 },
    { value: '7a', n: 1 },
  ])
})

// What a chart counted: only its non-empty steps, and the steps it spans.
const counted = (spread: { value: string; n: number }[]) =>
  Object.fromEntries(spread.filter(s => s.n > 0).map(s => [s.value, s.n]))
const span = (spread: { value: string; n: number }[]) => spread.map(s => s.value)
const FIVE_A_TO_8C = ['5a', '5b', '5c', '6a', '6b', '6c', '7a', '7b', '7c', '8a', '8b', '8c']

test('the grade spread always spans 5a to 8c, the empty steps at zero', () => {
  const spread = gradeSpreadOf(activityOf('falesia'), [via(1, '6a', 14), via(2, '6a', 15), via(3, '7a', 22)], 'grado')
  assert.deepEqual(span(spread), FIVE_A_TO_8C)
  assert.deepEqual(counted(spread), { '6a': 2, '7a': 1 })
  assert.equal(spread.find(s => s.value === '5a')?.n, 0, 'a crag with no 5a still shows the 5a column')
})

test('a grade outside 5a to 8c widens the span just enough to draw it', () => {
  const low = gradeSpreadOf(activityOf('falesia'), [via(1, '4c', 14), via(2, '6a', 15)], 'grado')
  assert.deepEqual(span(low), ['4c', ...FIVE_A_TO_8C])
  const high = gradeSpreadOf(activityOf('falesia'), [via(1, '7a', 14), via(2, '9a', 15)], 'grado')
  assert.deepEqual(span(high), [...FIVE_A_TO_8C, '9a'])
})

test('the grade spread counts a plus with its letter, at either end of the range', () => {
  const parts = [via(1, '4c+', 14), via(2, '6a', 15), via(3, '6a+', 22), via(4, '8c+', 18)]
  const spread = gradeSpreadOf(activityOf('falesia'), parts, 'grado')
  assert.deepEqual(counted(spread), { '4c': 1, '6a': 2, '8c': 1 })
  assert.deepEqual(span(spread), ['4c', ...FIVE_A_TO_8C])
})

test('the grade spread leaves a field that is not a sport grade as its distribution', () => {
  const parts = [via(1, '6a', 34), via(2, '6b', 14)]
  assert.deepEqual(gradeSpreadOf(activityOf('falesia'), parts, 'lunghezza'),
    distributionOf(activityOf('falesia'), parts, 'lunghezza'))
  assert.deepEqual(gradeSpreadOf(activityOf('falesia'), [], 'grado'), [])
})

test('a distribution over a numeric field sorts by value without re-parsing the formatted label', () => {
  const parts = [via(1, '6a', 34), via(2, '6b', 14), via(3, '7a', 14), via(4, '6b+', 20)]
  assert.deepEqual(distributionOf(activityOf('falesia'), parts, 'lunghezza'), [
    { value: '14 m', n: 2 },
    { value: '20 m', n: 1 },
    { value: '34 m', n: 1 },
  ])
})

const withAccess = defineActivity({
  id: 'test-access', label: { it: 'Test' },
  facts: [fact('quota', text, { label: { it: 'Quota' } })],
  access: [
    fact('nota', text, { label: { it: 'Nota' }, optional: true }),
    fact('altra', text, { label: { it: 'Altra' }, optional: true }),
  ],
  document: [], rail: [], current: { days: 7 },
})

test('resolveAccessFacts reads schema.access, not schema.facts', () => {
  const values = resolveAccessFacts(withAccess, { quota: 'x', nota: 'Slargo per 3 auto' }, [])
  assert.deepEqual(values.map(v => v.def.id), ['nota'])
  assert.equal(values[0]!.text, 'Slargo per 3 auto')
})

test('resolveAccessFacts never reports a missing access fact as a problem — every one is optional', () => {
  const values = resolveAccessFacts(withAccess, { quota: 'x' }, [])
  assert.deepEqual(values, [])
})

test('resolveFacts is unaffected by an activity that also declares access facts', () => {
  const values = resolveFacts(withAccess, { quota: 'x', nota: 'Slargo per 3 auto' }, [])
  assert.deepEqual(values.map(v => v.def.id), ['quota'],
    'the access fact must never leak into the header list')
})

const dashed = defineActivity({
  id: 'prova', label: { it: 'Prova' },
  facts: [
    fact('parete', text, { label: { it: 'Parete' }, optional: true, whenAbsent: 'dash' }),
    fact('ombra', text, { label: { it: 'Ombra' }, optional: true }),
    fact('sassi', boolean, { label: { it: 'Caduta sassi' }, optional: true, whenAbsent: 'dash' }),
  ],
  document: [], rail: [], current: { days: 7 },
})

test('an absent fact declared with a dash resolves to the dash; one without is skipped', () => {
  const values = resolveFacts(dashed, {}, [])
  assert.deepEqual(values.map(v => [v.def.id, v.value, v.text]),
    [['parete', null, ABSENT], ['sassi', null, ABSENT]])
})

test('readFact returns null for an absent dashed fact, so a Find row leaves the cell empty', () => {
  const def = dashed.facts.find(f => f.id === 'parete')!
  assert.ok(readFact(dashed, def, {}, []) === null)
  assert.equal(readFact(dashed, def, { parete: 'Sud' }, [])?.text, 'Sud')
})

test('a dashed fact that is present and unreadable is still an error', () => {
  assert.throws(() => resolveFacts(dashed, { sassi: 'forse' }, []), /sassi: boolean: expected true or false/)
})

test('an ordered quantity that is not a grade does not widen a crag\'s grade bounds', () => {
  const sport = gradeScale('sport')
  const bounds = gradeBoundsOf(activityOf('falesia'), { parete: 'strapiombante' },
    [via(1, '6a', 14), via(2, '7c', 34)])
  assert.deepEqual(bounds, { min: sport.ordinal('6a'), max: sport.ordinal('7c') })
})

test('a route graded in its header keeps that grade; its pitches do not widen it', () => {
  const schema = activityOf('multipitch')
  const parts = [{ id: 'a', group: null, position: 1, fields: { grado: '4b' } }]
  const withPitches = gradeBoundsOf(schema, { grado_max: '6c', grado_obbligatorio: '6a+' }, parts)
  const without = gradeBoundsOf(schema, { grado_max: '6c', grado_obbligatorio: '6a+' }, [])
  assert.deepEqual(withPitches, without)
})

test('missing facts are added, stored ones never replaced', () => {
  assert.deepEqual(withMissingFacts({ a: 1 }, { a: 2, b: 3 }), { a: 1, b: 3 })
  assert.equal(withMissingFacts({ a: 1 }, { a: 2 }), null)
})

test('a route that says how many pitches it has must list that many', () => {
  const two = [{ id: 'a', group: null, position: 1, fields: {} }, { id: 'b', group: null, position: 2, fields: {} }]
  assert.match(pitchCountMismatch({ tiri: 3 }, two)!, /tiri says 3, but 2 pitches/)
  assert.equal(pitchCountMismatch({ tiri: 2 }, two), null)
  assert.equal(pitchCountMismatch({ tiri: 3 }, []), null, 'a count alone is fine')
})
