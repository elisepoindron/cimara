import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readSource, type ForeignRow } from '../../src/import/source.ts'
import {
  ACTIVITY_CODES, translate, type Refusal, type Translated, type Vocabulary,
} from '../../src/import/translate.ts'
import { activityOf } from '../../src/domain/activities/index.ts'
import { resolveFacts } from '../../src/domain/facts.ts'

const ARCHIVE = fileURLToPath(
  new URL('../../src/import/data/archivio.json', import.meta.url))

const rows = await readSource(ARCHIVE)

/** The row at a 1-based riga, the way the report names it. */
const riga = (n: number): ForeignRow => {
  const row = rows[n - 1]
  assert.ok(row, `the archive has no riga ${n}`)
  return row
}

/**
 * What the archive holds when the import starts: the two activity codes the
 * export uses, and the comuni the seed already carries. Ostana is not among
 * them, on purpose — one row names it.
 */
const KNOWN: Vocabulary = {
  activities: ACTIVITY_CODES,
  places: { Crissolo: 'p-crissolo', Bussoleno: 'p-bussoleno' },
}

function accepted(t: Translated) {
  if (!t.ok) {
    assert.fail(`expected a translation, got: ${
      t.refusals.map(r => `${r.field}: ${r.reason}`).join('; ')}`)
  }
  return t
}

function refused(t: Translated): readonly Refusal[] {
  assert.equal(t.ok, false, 'expected a refusal, got a translated row')
  return t.ok ? [] : t.refusals
}

const fieldsOf = (t: Translated): string[] => refused(t).map(r => r.field)

/** A row invented for a case the archive does not carry. */
const invented = (fields: Record<string, unknown>): ForeignRow =>
  ({ riga: 99, ...fields })

/** An alpine row that translates, so one field can be spoiled at a time. */
const soundAlpine = (spoil: Record<string, unknown> = {}): ForeignRow => invented({
  titolo: 'Punta Inventata, Cresta Ovest', zona: 'Crissolo', att: 1,
  diff: 'PD', disl: 600, q_part: 2400, q_max: 3000, esp: 'N', gg: 1,
  lat: '44.6721', lon: '7.0842', data: '01/07/2020',
  descr: 'Inventata per questo test.', ...spoil,
})

/** A crag that translates, for the same reason. */
const soundCrag = (spoil: Record<string, unknown> = {}): ForeignRow => invented({
  titolo: 'Falesia Inventata', zona: 'Bussoleno', att: 2,
  q_part: 700, q_max: 740, esp: 'S', min_avv: 15, data: '01/07/2020',
  vie: [{ n: 1, nome: 'Prima', grado: '5a', lung: 14 }],
  ...spoil,
})

// ---------------------------------------------------------------------------
// The name, the place, the activity
// ---------------------------------------------------------------------------

test('a row with no title is refused: a route with no name cannot be found or linked', () => {
  const r = refused(translate(riga(10), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['titolo'])
  assert.equal(r[0]!.riga, 10, 'the refusal says where to look')
  assert.equal(r[0]!.found, '(nothing)')
})

test('a title of nothing but spaces is no title', () => {
  const r = refused(translate(riga(14), KNOWN))
  const titolo = r.find(f => f.field === 'titolo')

  assert.ok(titolo, 'the blank title is refused by name')
  assert.equal(titolo.found, '"   "', 'quoted, so the spaces are visible in the report')
})

test('a row with no place is refused', () => {
  assert.deepEqual(fieldsOf(translate(riga(11), KNOWN)), ['zona'])
})

test('a place the archive does not hold is refused: inventing a place is inventing geography', () => {
  const r = refused(translate(riga(12), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['zona'])
  assert.equal(r[0]!.found, '"Ostana"')
  assert.match(r[0]!.reason, /place/)
})

test('an activity number nothing declares is refused', () => {
  const r = refused(translate(riga(13), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['att'], 'the columns it cannot read are the activity’s own')
  assert.equal(r[0]!.found, '4')
})

test('an activity code written as text is the same code', () => {
  const t = accepted(translate(riga(23), KNOWN))
  assert.equal(t.itinerary.activity, 'falesia', 'att: "2" and att: 2 are one code')
})

test('a code that maps to an activity no registry declares is refused, not thrown', () => {
  const vocabulary: Vocabulary = { ...KNOWN, activities: { '1': 'scialpinismo' } }
  assert.deepEqual(fieldsOf(translate(riga(1), vocabulary)), ['att'])
})

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

test('a coordinate written as text is a number written as text, not a guess', () => {
  const t = accepted(translate(riga(1), KNOWN))

  assert.equal(t.itinerary.lat, 44.6721)
  assert.equal(t.itinerary.lon, 7.0842)
})

test('degrees, minutes and seconds are arithmetic', () => {
  const t = accepted(translate(riga(2), KNOWN))

  assert.equal(t.itinerary.lat, 44 + 40 / 60 + 14 / 3600)
  assert.equal(t.itinerary.lon, 7 + 5 / 60 + 2 / 3600)
})

test('the hemisphere letter carries the sign, in both directions', () => {
  const t = accepted(translate(soundAlpine({ lat: '45°03\'42"S', lon: '7°09\'18"W' }), KNOWN))

  assert.equal(t.itinerary.lat, -(45 + 3 / 60 + 42 / 3600))
  assert.equal(t.itinerary.lon, -(7 + 9 / 60 + 18 / 3600))
})

test('a row that was never placed arrives without coordinates', () => {
  const t = accepted(translate(riga(3), KNOWN))

  assert.equal(t.itinerary.lat, null, 'the schema allows it; only the map and near lose it')
  assert.equal(t.itinerary.lon, null)
})

test('half a coordinate is not a point', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ lon: undefined }), KNOWN)), ['lon'])
})

test('a degrees-minutes-seconds notation this archive does not use is refused, not approximated', () => {
  for (const written of [
    '44° 40\' 14" N',    // spaced
    '44°40.5\'N',        // decimal minutes
    '44°40\'14"',        // no hemisphere
    '44°70\'14"N',       // seventy minutes
    '44°40\'14"E',       // an east-west letter on a latitude
  ]) {
    assert.deepEqual(fieldsOf(translate(soundAlpine({ lat: written }), KNOWN)), ['lat'],
      `${written} should be refused rather than read as something near it`)
  }
})

test('a latitude off the globe is a typo, not a place', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ lat: '446.721' }), KNOWN)), ['lat'])
})

test('a coordinate written in a way this reader does not know is refused, not approximated', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ lat: '44,6721' }), KNOWN)), ['lat'],
    'a decimal comma is how half of Europe writes it, and this file does not')
})

test('the accesso column lands in come_arrivare, and nowhere else', () => {
  const t = accepted(translate(
    soundAlpine({ accesso: 'Da Bussoleno, sterrata per due chilometri' }), KNOWN))

  assert.equal(t.itinerary.facts.come_arrivare, 'Da Bussoleno, sterrata per due chilometri')
  assert.equal('localita_partenza' in t.itinerary.facts, false)
  assert.equal('da_torino' in t.itinerary.facts, false)
  assert.equal('parcheggio_nota' in t.itinerary.facts, false)
})

test('a blank accesso column leaves come_arrivare absent, not an empty string', () => {
  const t = accepted(translate(soundAlpine({ accesso: '' }), KNOWN))
  assert.equal('come_arrivare' in t.itinerary.facts, false)
})

test('a crag’s storico column lands in its storia, drawn inside the presentation', () => {
  const t = accepted(translate(
    soundCrag({ note: 'Bella falesia.', storico: 'Chiodata alla fine degli anni ’80.' }), KNOWN))
  assert.equal(t.itinerary.sections.note, 'Bella falesia.')
  assert.equal(t.itinerary.sections.storia, 'Chiodata alla fine degli anni ’80.')
})

test('the drive and the parking written in avvicinamento move to come_arrivare, the walk stays', () => {
  const t = accepted(translate(soundCrag({
    avvicinamento: 'Parcheggiare l’auto nella piazza della frazione. Imboccare il sentiero a destra, 10 minuti.',
  }), KNOWN))
  assert.equal(t.itinerary.facts.come_arrivare, 'Parcheggiare l’auto nella piazza della frazione.')
  assert.equal(t.itinerary.sections.avvicinamento, 'Imboccare il sentiero a destra, 10 minuti.')
  assert.deepEqual(t.interpretations.map(n => n.field), ['avvicinamento'],
    'whoever holds the source is told which words a rule moved')
})

test('an avvicinamento that is only the drive leaves no avvicinamento, and joins the accesso column', () => {
  const t = accepted(translate(soundCrag({
    accesso: 'Da Arnad verso Verres.',
    avvicinamento: 'Entrare nel borgo. Meglio parcheggiare nel borgo, non sotto le pareti.',
  }), KNOWN))
  assert.equal(t.itinerary.facts.come_arrivare,
    'Da Arnad verso Verres. Entrare nel borgo. Meglio parcheggiare nel borgo, non sotto le pareti.')
  assert.equal('avvicinamento' in t.itinerary.sections, false)
})

test('an avvicinamento on foot from the first word is left where it was', () => {
  const t = accepted(translate(soundCrag({
    avvicinamento: 'Sentiero a monte del parcheggio, poi traccia nel bosco.',
  }), KNOWN))
  assert.equal(t.itinerary.sections.avvicinamento, 'Sentiero a monte del parcheggio, poi traccia nel bosco.')
  assert.equal('come_arrivare' in t.itinerary.facts, false)
  assert.deepEqual(t.interpretations, [])
})

test('a crag with no storico column has no storia, not an empty one', () => {
  const t = accepted(translate(soundCrag({ note: 'Bella falesia.' }), KNOWN))
  assert.equal('storia' in t.itinerary.sections, false)
})

// ---------------------------------------------------------------------------
// Grades — the central rule
// ---------------------------------------------------------------------------

test('a grade on the activity’s scale is taken as written', () => {
  const t = accepted(translate(riga(1), KNOWN))
  assert.equal(t.itinerary.facts['difficolta'], 'PD+')
})

test('a grade reading AD/D is taken at its left side, and says so', () => {
  // It means "between", and this archive holds one grade per route. The
  // designer's rule is the left side, the one written first; the spec once
  // refused the row instead. Either way it is a choice, so it is reported.
  const t = accepted(translate(riga(5), KNOWN))
  assert.equal(t.itinerary.facts['difficolta'], 'AD')
  assert.deepEqual(t.interpretations,
    [{ riga: 5, field: 'diff', found: '"AD/D"', readAs: 'AD, the grade left of the slash' }])
})

test('a grade read as written carries no interpretation', () => {
  assert.deepEqual(accepted(translate(riga(1), KNOWN)).interpretations, [])
})

test('a slash grade whose left side is on no scale is still refused', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ diff: 'III+/IV' }), KNOWN)), ['diff'])
  assert.deepEqual(fieldsOf(translate(soundAlpine({ diff: '/AD' }), KNOWN)), ['diff'])
})

test('a grade from another scale is refused: III+ is not an alpine grade', () => {
  assert.deepEqual(fieldsOf(translate(riga(6), KNOWN)), ['diff'])
})

test('a via graded 5c+ is a 5c+: the step the sport scale gained for it', () => {
  const t = accepted(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '5c+', lung: 14 }] }), KNOWN))
  assert.equal(t.parts[0]!.fields['grado'], '5c+')
})

test('a grade written in another letter case is the same grade: 5C is 5c, pd+ is PD+', () => {
  const crag = accepted(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '5C', lung: 14 }] }), KNOWN))
  assert.equal(crag.parts[0]!.fields['grado'], '5c')

  const alpine = accepted(translate(soundAlpine({ diff: 'pd+' }), KNOWN))
  assert.equal(alpine.itinerary.facts['difficolta'], 'PD+')
})

test('a via graded 6c- is a 6c, and the dropped minus is reported', () => {
  const t = accepted(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '6c-', lung: 14 }] }), KNOWN))
  assert.equal(t.parts[0]!.fields['grado'], '6c')
  assert.deepEqual(t.interpretations,
    [{ riga: t.interpretations[0]!.riga, field: 'vie[1].grado', found: '"6c-"', readAs: '6c, the grade without its minus' }])
})

test('a via graded pitch by pitch is read at its first grade, and reported', () => {
  const t = accepted(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '6c+ (L2 7b)', lung: 30 }] }), KNOWN))
  assert.equal(t.parts[0]!.fields['grado'], '6c+')
  assert.equal(t.interpretations[0]!.readAs, '6c+, the grade before the brackets')
})

test('brackets after something that is not a grade do not make it one', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: 'V+ (6a)', lung: 14 }] }), KNOWN)),
    ['vie[1].grado'])
})

test('a minus the scale has is read as written, not dropped: AD- is AD-', () => {
  const t = accepted(translate(soundAlpine({ diff: 'AD-' }), KNOWN))
  assert.equal(t.itinerary.facts['difficolta'], 'AD-')
  assert.deepEqual(t.interpretations, [])
})

test('a length is never read by a grade rule: 15- is refused, not 15', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '6a', lung: '15-' }] }), KNOWN)),
    ['vie[1].lung'])
})

for (const written of ['5+', '4°', '6c--']) {
  test(`a via graded ${written} is still refused: case, a slash and a minus are the only things forgiven`, () => {
    const r = refused(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: written, lung: 14 }] }), KNOWN))
    assert.deepEqual(r.map(f => f.field), ['vie[1].grado'])
  })
}

test('a sport grade filed under alpinismo is refused', () => {
  assert.deepEqual(fieldsOf(translate(riga(9), KNOWN)), ['diff'])
})

test('a blank grade is absent, not wrong: the registry declares it optional', () => {
  // This row refused until the registry learned to say that a fact may be
  // genuinely unknown. A twenty-year-old archive holds routes whose grade
  // nobody ever filled in, and refusing them was a claim about the world.
  const t = accepted(translate(riga(4), KNOWN))

  assert.equal('difficolta' in t.itinerary.facts, false,
    'the facts strip is one item shorter, and says nothing it does not know')
})

test('a grade that is present and unreadable still refuses the row', () => {
  // Nobody wrote it, and somebody wrote something nothing can read, are
  // different things. Only the first is absence.
  const r = refused(translate(soundAlpine({ diff: 'AD forse' }), KNOWN))
  assert.deepEqual(r.map(f => f.field), ['diff'])
})

// ---------------------------------------------------------------------------
// Figures and days
// ---------------------------------------------------------------------------

test('a figure quoted in the source is the same figure', () => {
  const t = accepted(translate(riga(1), KNOWN))

  assert.equal(t.itinerary.facts['dislivello'], 820)
  assert.equal(t.itinerary.facts['partenza'], 2340)
  assert.equal(t.itinerary.facts['vetta'], 3160)
  assert.equal(t.itinerary.altMax, 3160)
  assert.equal(t.itinerary.aspect, 'NE')
  assert.equal(t.itinerary.facts['giorni'], 1)
})

test('a figure that is not a figure is refused', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ disl: 'circa 800' }), KNOWN)), ['disl'])
})

test('a day written 14/09/2026 is a day, and becomes one', () => {
  const t = accepted(translate(riga(2), KNOWN))
  assert.equal(t.itinerary.created, '2026-09-14T00:00:00.000Z')
})

test('a day that is not a day is refused: 31 February', () => {
  const r = refused(translate(riga(7), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['data'],
    'gg: "2" on the same row read fine; only the date is wrong')
  assert.equal(r[0]!.found, '"31/02/2026"')
})

test('a day in an order this source does not write is refused', () => {
  assert.deepEqual(fieldsOf(translate(riga(8), KNOWN)), ['data'])
})

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

test('prose the web form left markup in arrives as text, not as markup', () => {
  const t = accepted(translate(riga(2), KNOWN))
  const descrizione = t.itinerary.sections['descrizione']

  assert.equal(typeof descrizione, 'string')
  assert.ok(descrizione!.includes('<b>Primo tratto</b>'),
    'kept as the contributor wrote it; the renderer escapes it into characters')
})

test('every prose column the source carries lands in its own section', () => {
  const t = accepted(translate(riga(1), KNOWN))

  // accesso is no longer a prose section — the registry now declares it an
  // access fact, and it lands in facts.come_arrivare instead (see the
  // "accesso column" tests above).
  assert.deepEqual(Object.keys(t.itinerary.sections).sort(),
    ['avvicinamento', 'descrizione', 'discesa', 'materiale', 'note'])
})

test('a prose column the source does not carry is an absence, not an error', () => {
  const t = accepted(translate(soundAlpine({ note: undefined, mat: undefined }), KNOWN))

  assert.deepEqual(Object.keys(t.itinerary.sections), ['descrizione'])
})

test('a crag with nothing to report arrives with nothing to report', () => {
  const t = accepted(translate(riga(25), KNOWN))
  assert.equal(t.reports.length, 0)
})

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

test('a report arrives as its day and its words', () => {
  const t = accepted(translate(riga(1), KNOWN))

  assert.deepEqual(t.reports.map(r => r.observedAt), ['2026-09-09', '2026-09-12'])
  assert.ok(t.reports.every(r => r.words.length > 0))
  assert.deepEqual(Object.keys(t.reports[0]!).sort(), ['observedAt', 'words'],
    'the giudizio and the snow line the export carries are not read: this archive keeps neither')
})

test('a crag’s shade is read off the crag, as a span of two clock times', () => {
  assert.deepEqual(accepted(translate(riga(19), KNOWN)).itinerary.facts.ombra_dalle, ['13:10', '15:40'])
  assert.equal('ombra_dalle' in accepted(translate(riga(25), KNOWN)).itinerary.facts, false,
    'optional: a crag nobody timed imports without it')
})

test('a shade span that runs backwards is refused, not reordered', () => {
  assert.deepEqual(fieldsOf(translate({ ...riga(19), ombra: ['15:40', '13:10'] }, KNOWN)), ['ombra'])
})

test('a verdict the source spells in a way no level reads is no longer a refusal', () => {
  const t = accepted(translate(soundAlpine({ relazioni: [
    { data: '09/09/2026', giudizio: 'Fuori Condizione', testo: 'Tornati indietro.' }] }), KNOWN))
  assert.deepEqual(t.reports, [{ observedAt: '2026-09-09', words: 'Tornati indietro.' }])
})

test('a report’s words are kept, trimmed', () => {
  const t = accepted(translate(soundAlpine({ relazioni: [
    { data: '09/09/2026', giudizio: 'buone', testo: '  Neve dura in alto.  ' }] }), KNOWN))
  assert.deepEqual(t.reports, [{ observedAt: '2026-09-09', words: 'Neve dura in alto.' }])
})

test('a report with no words is skipped, not refused: it says nothing this archive keeps', () => {
  const t = accepted(translate(soundAlpine({ relazioni: [
    { data: '09/09/2026', giudizio: 'buone' }, { data: '10/09/2026', testo: '   ' }] }), KNOWN))
  assert.deepEqual(t.reports, [])
})

test('words that are not text are still refused, by name', () => {
  assert.deepEqual(fieldsOf(translate(soundAlpine({ relazioni: [{ data: '09/09/2026', testo: 42 }] }), KNOWN)),
    ['relazioni[1].testo'])
})

test('an unreadable report refuses the row: a route missing one of its reports looks complete', () => {
  assert.deepEqual(
    fieldsOf(translate(soundAlpine({ relazioni: [{ data: '31/02/2026', giudizio: 'buone' }] }), KNOWN)),
    ['relazioni[1].data'])
})

test('a measure the source writes is not read, so it cannot refuse a row', () => {
  const t = accepted(translate(soundAlpine(
    { relazioni: [{ data: '09/09/2026', neve: 'sopra i 3000', testo: 'Neve alta.' }] }), KNOWN))
  assert.deepEqual(t.reports, [{ observedAt: '2026-09-09', words: 'Neve alta.' }])
})

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

test('a crag’s vie become its parts, numbered and grouped as the source has them', () => {
  const t = accepted(translate(riga(19), KNOWN))

  assert.equal(t.parts.length, 6)
  assert.deepEqual(t.parts.map(p => p.position), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(t.parts[0]!.fields, { nome: 'Acqua fredda', grado: '5b', lunghezza: 18 })
  assert.deepEqual([...new Set(t.parts.map(p => p.group))], ['Lavatoio', 'Placca grigia'])
})

test('a crag with no approach time arrives without one: its page estimates it from the trail', () => {
  const t = accepted(translate(soundCrag({ min_avv: null }), KNOWN))
  assert.equal('avvicinamento' in t.itinerary.facts, false)
})

test('an approach written as a distance is still refused, never converted to minutes', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ min_avv: '300 m' }), KNOWN)), ['min_avv'])
})

test('a via with no length is a via of unknown length, not a refused crag', () => {
  const t = accepted(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '5a', lung: null }] }), KNOWN))
  assert.deepEqual(t.parts[0]!.fields, { nome: 'Prima', grado: '5a' })
})

test('a via length that is present and unreadable still refuses the crag', () => {
  const r = refused(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: '5a', lung: 'circa 15' }] }), KNOWN))
  assert.deepEqual(r.map(f => f.field), ['vie[1].lung'])
})

test('a via with no name is a nameless via, not a refused crag', () => {
  const t = accepted(translate(soundCrag({ vie: [{ n: 1, nome: null, grado: '5a', lung: 14 }] }), KNOWN))
  assert.deepEqual(t.parts[0]!.fields, { grado: '5a', lunghezza: 14 })
})

test('a via with no grade is an ungraded via, beside graded ones', () => {
  const t = accepted(translate(soundCrag({ vie: [
    { n: 1, nome: 'Prima', grado: '5a', lung: 14 },
    { n: 2, nome: 'Variante', grado: null, lung: 10 },
  ] }), KNOWN))
  assert.deepEqual(t.parts[1]!.fields, { nome: 'Variante', lunghezza: 10 })
})

test('a crag none of whose vie is graded is still refused: it has no gradi to show', () => {
  const r = refused(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: null, lung: 14 }] }), KNOWN))
  assert.ok(r.some(f => /gradi/.test(f.reason)), r.map(f => f.reason).join('; '))
})

test('a crag whose sectors were never filled in keeps its vie and loses only the grouping', () => {
  const t = accepted(translate(riga(21), KNOWN))
  assert.deepEqual(t.parts.map(p => p.group), [null, null, null, null])
})

test('a via on no scale refuses the crag: its facts are derived from its vie', () => {
  const r = refused(translate(soundCrag({ vie: [{ n: 1, nome: 'Prima', grado: 'V+', lung: 14 }] }), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['vie[1].grado'],
    'the grade range and the count of vie are read off the parts, so one bad via is a bad header')
  assert.equal(r[0]!.found, '"V+"')
})

test('a via graded 6b/6c is a 6b, reported against the via it came from', () => {
  const t = accepted(translate(riga(22), KNOWN))
  assert.equal(t.parts[2]!.fields['grado'], '6b')
  assert.deepEqual(t.interpretations.map(n => [n.field, n.found]), [['vie[3].grado', '"6b/6c"']])
})

test('a via with no number is refused rather than renumbered', () => {
  assert.deepEqual(
    fieldsOf(translate(soundCrag({ vie: [{ nome: 'Senza numero', grado: '5a', lung: 14 }] }), KNOWN)),
    ['vie[1].n'])
})

test('a crag with no vie at all is refused: three of its facts have nothing to derive from', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ vie: [] }), KNOWN)), ['vie'])
})

test('an alpine route carries no parts, and is not asked for any', () => {
  const t = accepted(translate(riga(1), KNOWN))
  assert.equal(t.parts.length, 0)
})

// ---------------------------------------------------------------------------
// Several problems, and the archive as a whole
// ---------------------------------------------------------------------------

test('a row wrong in three ways returns three refusals, not the first', () => {
  const r = refused(translate(riga(14), KNOWN))

  assert.deepEqual(r.map(f => f.field), ['titolo', 'att', 'data'])
  for (const one of r) assert.equal(one.riga, 14)
})

test('two crags of one name in two comuni are two crags', () => {
  const a = accepted(translate(riga(19), KNOWN))
  const b = accepted(translate(riga(20), KNOWN))

  assert.equal(a.itinerary.name, b.itinerary.name)
  assert.notEqual(a.itinerary.placeId, b.itinerary.placeId)
})

test('translation is arithmetic: the same row twice is the same answer', () => {
  for (const row of rows) {
    assert.deepEqual(translate(row, KNOWN), translate(row, KNOWN),
      `riga ${row.riga} translated differently on a second reading`)
  }
})

test('the archive translates seventeen of its twenty-six rows, and names the rest', () => {
  const results = rows.map(row => translate(row, KNOWN))
  const refusedRighe = results.flatMap(t => (t.ok ? [] : [t.refusals[0]!.riga]))

  assert.equal(results.filter(t => t.ok).length, 17)
  assert.deepEqual(refusedRighe, [6, 7, 8, 9, 10, 11, 12, 13, 14],
    'riga 5 (AD/D) and riga 22 (6b/6c) left them once a slash grade was read at its left side')
})

test('every refusal names a field, a reason and what was there', () => {
  for (const row of rows) {
    const t = translate(row, KNOWN)
    if (t.ok) continue
    for (const r of t.refusals) {
      assert.equal(r.riga, row.riga)
      assert.ok(r.field.length > 0, `riga ${row.riga}: a refusal with no field is not a report`)
      assert.ok(r.reason.length > 0, `riga ${row.riga}, ${r.field}: no reason given`)
      assert.ok(r.found.length > 0, `riga ${row.riga}, ${r.field}: what was found is not stated`)
    }
  }
})

test('what translates would survive the page it renders', () => {
  for (const row of rows) {
    const t = translate(row, KNOWN)
    if (!t.ok) continue
    const schema = activityOf(t.itinerary.activity)
    const parts = t.parts.map((p, i) => ({ id: `p${i}`, ...p }))

    // resolveFacts is what the boot check and the renderer call. A row that
    // translates and then throws here is a row that would 500 its own page.
    resolveFacts(schema, t.itinerary.facts, parts)
  }
})

test('a crag’s guidebook facts are read off the crag', () => {
  const facts = accepted(translate(riga(19), KNOWN)).itinerary.facts
  assert.deepEqual(facts.parete, ['verticale'], 'one angle written alone is a set of one')
  assert.deepEqual(facts.stagione, ['primavera', 'autunno'])
  assert.equal(facts.per_famiglie, true)
  assert.equal(facts.bellezza, 4, 'a rating written as text is the same figure')
  assert.equal('tranquillita' in facts, false, 'a blank rating is absent, not wrong')
})

test('half a star is refused, not rounded', () => {
  const r = refused(translate(soundCrag({ v_bellezza: 4.5 }), KNOWN))
  assert.deepEqual(r.map(x => x.field), ['v_bellezza'])
  assert.match(r[0]!.reason, /whole number from 1 to 5/)
})

test('a rating on another scale is refused, not rescaled', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ v_chiodatura: 0 }), KNOWN)), ['v_chiodatura'])
  assert.deepEqual(fieldsOf(translate(soundCrag({ v_comodita: 10 }), KNOWN)), ['v_comodita'])
})

test('a wall angle this archive does not name is refused', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ parete: 'strapiombo' }), KNOWN)), ['parete'])
})

test('an empty season list is refused, and so is a season named twice', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ stagioni: [] }), KNOWN)), ['stagioni'])
  assert.deepEqual(fieldsOf(translate(soundCrag({ stagioni: ['estate', 'estate'] }), KNOWN)), ['stagioni'])
})

test('a yes written as a word is refused rather than guessed', () => {
  assert.deepEqual(fieldsOf(translate(soundCrag({ pioggia: 'si' }), KNOWN)), ['pioggia'])
})
