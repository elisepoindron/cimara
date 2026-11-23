import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRY_DEFAULT_DAYS, dryWritten, NEARBY_KM, parse, type Constraint, type Vocabulary } from '../../src/domain/find/constraints.ts'
import { gradeScale } from '../../src/domain/quantity.ts'

/**
 * Two activities the registry declares, and six places. The places are real
 * geography, as everything geographic in this project is, and three of them are
 * there for a collision the archive will really produce:
 *
 *  - `Val Grande` is a proper prefix of `Val Grande di Lanzo`, so the longest
 *    match rule has something to be right about;
 *  - `PD` is the province of Padova and also a grade on the alpine scale.
 */
const VOCAB: Vocabulary = {
  activities: [{ id: 'alpinismo', label: 'Alpinismo' }, { id: 'falesia', label: 'Falesia' }],
  places: [
    { id: 'p1', name: 'Torino' },
    { id: 'p2', name: 'Monviso' },
    { id: 'p3', name: 'Valle dell’Orco' },
    { id: 'p4', name: 'Val Grande' },
    { id: 'p5', name: 'Val Grande di Lanzo' },
    { id: 'p6', name: 'PD' },
  ],
}

const kinds = (line: string) => parse(line, VOCAB).map(c => c.kind).sort()
const only = <K extends Constraint['kind']>(line: string, kind: K) => {
  const found = parse(line, VOCAB).filter(c => c.kind === kind)
  assert.equal(found.length, 1, `expected exactly one ${kind} constraint in ${JSON.stringify(line)}`)
  return found[0] as Extract<Constraint, { kind: K }>
}

const alpine = gradeScale('alpine')
const sport = gradeScale('sport')

test('the design’s own line', () => {
  const cs = parse('alpinismo entro 40 km da Torino fino a AD', VOCAB)
  assert.deepEqual(cs.map(c => c.kind).sort(), ['activity', 'grade', 'near'])

  const near = only('alpinismo entro 40 km da Torino fino a AD', 'near')
  assert.equal(near.withinKm, 40)
  assert.equal(near.placeName, 'Torino')
  assert.equal(near.placeId, 'p1')
})

test('a place the archive holds is a place, not free text', () => {
  assert.deepEqual(kinds('Monviso'), ['place'])
  assert.equal(only('Monviso', 'place').id, 'p2')
})

test('a name the archive does not hold is free text', () => {
  const cs = parse('Cresta Est', VOCAB)
  assert.deepEqual(cs.map(c => c.kind), ['name'])
  assert.equal(only('Cresta Est', 'name').text, 'Cresta Est')
})

test('a multi-word place beats the words inside it', () => {
  assert.deepEqual(kinds('Valle dell’Orco'), ['place'])
  assert.deepEqual(kinds('Val Grande di Lanzo'), ['place'])
  assert.equal(only('Val Grande di Lanzo', 'place').id, 'p5',
    'the long name is a place of its own, not the short one plus two loose words')
  assert.equal(only('Val Grande', 'place').id, 'p4', 'and the short one still answers')
})

test('an activity answers to its id or to its label', () => {
  assert.deepEqual(kinds('alpinismo'), ['activity'])
  assert.deepEqual(kinds('Alpinismo'), ['activity'])
  assert.deepEqual(kinds('falesia'), ['activity'])
  assert.equal(only('Alpinismo', 'activity').id, 'alpinismo')
})

test('a grade names its own scale, so it names its activity too', () => {
  const cs = parse('fino a AD', VOCAB)
  assert.deepEqual(cs.map(c => c.kind).sort(), ['activity', 'grade'])

  const activity = only('fino a AD', 'activity')
  assert.equal(activity.id, 'alpinismo')
  assert.equal(activity.inferred, true, 'nobody typed it, so the sentence marks it .inf')

  const grade = only('fino a AD', 'grade')
  assert.equal(grade.scale, 'alpine')
  assert.equal(grade.min, 0, 'fino a starts at the bottom of the scale')
  assert.equal(grade.max, alpine.ordinal('AD'))
  assert.equal(grade.written, 'fino a AD')
})

test('a sport grade names the other one', () => {
  const activity = only('dal 6a al 7b', 'activity')
  assert.equal(activity.id, 'falesia')

  const grade = only('dal 6a al 7b', 'grade')
  assert.equal(grade.scale, 'sport')
  assert.equal(grade.min, sport.ordinal('6a'))
  assert.equal(grade.max, sport.ordinal('7b'))
})

test('a range reads the same either way round', () => {
  const up = parse('dal 6a al 7b', VOCAB).find(c => c.kind === 'grade')!
  const down = parse('dal 7b al 6a', VOCAB).find(c => c.kind === 'grade')!
  assert.deepEqual(up, down, 'nobody should have to know which end comes first')
  assert.equal(up.kind === 'grade' && up.written, 'dal 6a al 7b')
})

test('a bare grade is a range of one', () => {
  const grade = only('6a+', 'grade')
  assert.equal(grade.min, sport.ordinal('6a+'))
  assert.equal(grade.max, sport.ordinal('6a+'))
  assert.equal(grade.written, '6a+')
})

test('a grade answers whatever case it is typed in', () => {
  assert.equal(only('fino a ad+', 'grade').max, alpine.ordinal('AD+'))
  assert.equal(only('dal 6A al 7B', 'grade').max, sport.ordinal('7b'))
  assert.equal(only('fino a ad+', 'grade').written, 'fino a AD+',
    'and reads back the way the scale writes it')
})

test('an activity the visitor set is not overridden by a grade', () => {
  const cs = parse('alpinismo fino a AD', VOCAB)
  assert.equal(cs.filter(c => c.kind === 'activity').length, 1)
  assert.equal(only('alpinismo fino a AD', 'activity').inferred, false)
})


test('a range across two scales is not a range', () => {
  // AD and 6a are ordinals on different scales and nothing spans them, so the
  // range declines. Left to right, each end is then read on its own merits —
  // a floor on one scale and a ceiling on the other — which is the rule
  // everywhere else and gets no exception here.
  const cs = parse('dal AD al 6a', VOCAB)
  assert.deepEqual(cs.map(c => c.kind).sort(), ['grade', 'grade'])
  assert.deepEqual(
    cs.filter(c => c.kind === 'grade').map(c => c.scale).sort(), ['alpine', 'sport'])
})

test('no activity is guessed when the line\u2019s grades disagree about the scale', () => {
  // Inference becomes a hard constraint, and a hard constraint must never be a
  // coin toss. Two scales in one line means the sentence shows both grades and
  // names no activity.
  assert.equal(parse('dal AD al 6a', VOCAB).filter(c => c.kind === 'activity').length, 0)
})

test('an empty line is a legitimate query, not an error', () => {
  assert.deepEqual(parse('', VOCAB), [])
  assert.deepEqual(parse('    ', VOCAB), [])
  assert.deepEqual(parse('\t\n    ', VOCAB), [])
})

test('what it cannot read it keeps, rather than dropping', () => {
  const free = only('alpinismo pizza', 'name')
  assert.equal(free.text, 'pizza', 'a word nobody understood is still what the visitor typed')
})

test('leftovers from either end of the line become one name', () => {
  assert.equal(only('Cresta alpinismo Est', 'name').text, 'Cresta Est')
})

test('a typographic apostrophe and a typed one are the same place', () => {
  assert.equal(only('Valle dell’Orco', 'place').id, 'p3')
  assert.equal(only("Valle dell'Orco", 'place').id, 'p3')
  assert.equal(only("valle DELL'orco", 'place').id, 'p3')
  assert.equal(only("Valle    dell'Orco", 'place').id, 'p3', 'runs of space are one space')
  assert.equal(only("Valle dell'Orco", 'place').name, 'Valle dell’Orco',
    'and the place reads back the way the archive spells it')
})

test('free text comes back exactly as it was typed', () => {
  // Matching folds case, apostrophes and accents; what is handed on does not.
  // The name constraint is matched against route names, and a route called
  // "Diedro dell’Amicizia" is spelled the way the visitor spelled it.
  assert.equal(only('Diedro dell’Amicizia', 'name').text, 'Diedro dell’Amicizia')
  assert.equal(only("Diedro dell'Amicizia", 'name').text, "Diedro dell'Amicizia")
  assert.equal(only('Città   Morta', 'name').text, 'Città Morta')
})

test('a place the archive holds beats a grade spelled the same way', () => {
  // PD is the province of Padova and PD is also a grade. The row wins: the
  // vocabulary is evidence that this archive holds something by that name, while
  // the grade reading is a guess that would also narrow to an activity nobody
  // typed.
  assert.deepEqual(kinds('PD'), ['place'])
  assert.equal(only('PD', 'place').id, 'p6')
})

test('but a written grade form beats a place spelled the same way', () => {
  // "fino a" is Italian the visitor typed on purpose, so it outranks a name
  // collision. Every written form does.
  const grade = only('fino a PD', 'grade')
  assert.equal(grade.max, alpine.ordinal('PD'))
  assert.deepEqual(kinds('fino a PD'), ['activity', 'grade'])
})

test('a bare numeral is not a grade', () => {
  // "3" is the bottom of the sport scale and also a year, a rifugio, a sector
  // number and half of every route name with a number in it. On its own it is
  // free text; the written forms are how a bare numeral means a grade.
  assert.deepEqual(kinds('3'), ['name'])
  assert.equal(only('fino a 3', 'grade').max, sport.ordinal('3'))
})

test('drive time is not built, and does not quietly become a radius', () => {
  // "entro 2 ore da Torino" is the design’s own line and the one thing this
  // project deliberately cannot answer. It must not come back as a 2 km radius.
  const cs = parse('entro 2 ore da Torino', VOCAB)
  assert.equal(cs.filter(c => c.kind === 'near').length, 0)
  assert.equal(only('entro 2 ore da Torino', 'place').id, 'p1')
  assert.equal(only('entro 2 ore da Torino', 'name').text, 'entro 2 ore da')
})

test('a radius reaches a multi-word place, and its unit may be glued on', () => {
  assert.equal(only('entro 15 km da Valle dell’Orco', 'near').placeId, 'p3')
  assert.equal(only('entro 40km da Torino', 'near').withinKm, 40)
  assert.equal(only('entro 2,5 km da Torino', 'near').withinKm, 2.5)
})

test('a place or an activity with one slip in it is still read', () => {
  const forgiving = (line: string) => parse(line, VOCAB, { forgivePlaces: true })
  const placeOf = (line: string) => forgiving(line).find(c => c.kind === 'place')
  assert.equal(placeOf('Torine')?.kind === 'place' && placeOf('Torine')?.id, 'p1', 'a letter changed')
  assert.equal(placeOf('Monvisio')?.kind === 'place' && placeOf('Monvisio')?.id, 'p2', 'a letter added')
  assert.equal(only('falsia', 'activity').id, 'falesia', 'a letter dropped')
  assert.equal(only('alpinsimo', 'activity').id, 'alpinismo', 'two letters swapped')
  assert.equal(only('entro 40 km da Trino', 'near').placeId, 'p1', 'inside a written form too')
})

test('a slip is forgiven only where nothing matched exactly, and only in a long word', () => {
  // Two edits is a different word, not a typo of this one.
  assert.deepEqual(kinds('falaise'), ['name'])
  // Below five letters one edit is too large a share of the word.
  assert.deepEqual(kinds('PE'), ['name'])
  // A word read exactly is never re-read as something one letter away.
  assert.equal(only('Torino', 'place').id, 'p1')
})

test('a radius around a place the archive does not hold is not a radius', () => {
  assert.deepEqual(kinds('entro 40 km da Pizza'), ['name'])
})

test('a grade no activity in the vocabulary uses is not a grade', () => {
  // The scales come from the registry by way of the vocabulary, so a grade only
  // exists where some activity actually uses its scale. An alpine grade against
  // an archive that holds only crags would make a constraint whose ordinals
  // nothing could be compared against — which is the cross-scale mistake the
  // whole design is arranged to prevent.
  const cragsOnly: Vocabulary = { activities: [{ id: 'falesia', label: 'Falesia' }], places: [] }
  assert.deepEqual(parse('fino a AD', cragsOnly).map(c => c.kind), ['name'])
  assert.deepEqual(parse('fino a 6a', cragsOnly).map(c => c.kind).sort(), ['activity', 'grade'])

  const unknown: Vocabulary = { activities: [{ id: 'passeggiata', label: 'Passeggiata' }], places: [] }
  assert.deepEqual(parse('fino a 6a', unknown).map(c => c.kind), ['name'],
    'an id no registry file declares brings no scale, so 6a is just a word')
})

test('the same question in a different vocabulary order parses the same', () => {
  const shuffled: Vocabulary = {
    activities: [...VOCAB.activities].reverse(),
    places: [...VOCAB.places].reverse(),
  }
  const line = 'Val Grande di Lanzo entro 40 km da Torino fino a AD'
  assert.deepEqual(parse(line, shuffled), parse(line, VOCAB))
})

test('typing a word twice asks the same question once', () => {
  assert.deepEqual(kinds('Torino Torino'), ['place'])
})

test('a line of punctuation is kept, not read', () => {
  assert.equal(only('!!! ??? …', 'name').text, '!!! ??? …')
  assert.equal(only('---', 'name').text, '---')
})

test('a very long line parses without throwing', () => {
  const long = 'pizza '.repeat(2_000)
  const cs = parse(long, VOCAB)
  assert.equal(cs.length, 1)
  assert.equal(cs[0]!.kind, 'name')

  const repeated = 'Val Grande di Lanzo '.repeat(500)
  assert.deepEqual(parse(repeated, VOCAB).map(c => c.kind), ['place'])
})

test('a place name is not read out of the middle of a word', () => {
  assert.deepEqual(kinds('Torinese'), ['name'])
})

test('a fact phrase is a constraint on the activity that declares it', () => {
  const cs = parse('con la pioggia', VOCAB)
  assert.deepEqual(cs.map(c => c.kind), ['activity', 'fact'])
  const fact = only('con la pioggia', 'fact')
  assert.deepEqual([fact.activities, fact.id, fact.match, fact.value, fact.written],
    [['falesia'], 'con_la_pioggia', 'is', true, 'con la pioggia'])
  assert.equal(only('con la pioggia', 'activity').inferred, true, 'nobody typed falesia')
})

test('every spelling reads as the same question, and reads back as typed', () => {
  assert.equal(only('al riparo dalla pioggia', 'fact').id, 'con_la_pioggia')
  assert.equal(only('riparate dalla pioggia', 'fact').id, 'con_la_pioggia')
  assert.equal(only('quando piove', 'fact').id, 'con_la_pioggia')
  assert.equal(only('quando piove', 'fact').written, 'quando piove')
  assert.equal(only('Con La Pioggia', 'fact').id, 'con_la_pioggia', 'case folds')
  assert.equal(only('con bambini', 'fact').id, 'per_famiglie')
})

test('a season word asks whether the crag’s seasons include it', () => {
  const fact = only('estiva', 'fact')
  assert.deepEqual([fact.id, fact.match, fact.value], ['stagione', 'includes', 'estate'])
  assert.equal(only('invernale', 'fact').value, 'inverno')
})

test('the same fact asked twice is asked once', () => {
  assert.equal(parse('con la pioggia quando piove', VOCAB).filter(c => c.kind === 'fact').length, 1)
})

test('a typed activity is kept, and a fact phrase under it still applies', () => {
  const cs = parse('falesia per famiglie entro 30 km da Torino', VOCAB)
  assert.deepEqual(cs.map(c => c.kind).sort(), ['activity', 'fact', 'near'])
  assert.equal(only('falesia per famiglie', 'activity').inferred, false)
})


test('two fact phrases of one activity infer it once', () => {
  const cs = parse('con la pioggia per famiglie', VOCAB)
  assert.equal(cs.filter(c => c.kind === 'activity').length, 1)
  assert.equal(cs.filter(c => c.kind === 'fact').length, 2)
})


// ---------------------------------------------------------------------------
// Floors and comparisons

test('"falesia sopra 6a" asks for everything harder than 6a, written back as a floor', () => {
  const grade = only('falesia sopra 6a', 'grade')
  assert.equal(grade.scale, 'sport')
  assert.equal(grade.min, sport.ordinal('6a+'), 'sopra is taken at its word: one step up')
  assert.equal(grade.max, sport.ordinal('9a'), 'and runs to the top of the scale')
  assert.equal(grade.written, 'dal 6a+ in su')
  assert.deepEqual(kinds('falesia sopra 6a'), ['activity', 'grade'], 'no word is left over')
})

test('almeno, minimo and dal … in su include the grade they name', () => {
  for (const line of ['almeno 6a', 'minimo 6a', 'dal 6a in su', 'da 6a in su', 'dal 6A in su']) {
    const grade = only(line, 'grade')
    assert.equal(grade.min, sport.ordinal('6a'), line)
    assert.equal(grade.written, 'dal 6a in su', line)
  }
})

test('oltre, più di and an article in between all read as sopra', () => {
  for (const line of ['oltre 6a', 'più di 6a', 'piu di 6a', 'più del 6a', 'sopra il 6a', 'oltre al 6a']) {
    assert.equal(only(line, 'grade').written, 'dal 6a+ in su', line)
  }
})

test('sotto and meno di are a ceiling one step down', () => {
  for (const line of ['sotto 6a', 'meno di 6a', 'sotto il 6a']) {
    const grade = only(line, 'grade')
    assert.equal(grade.min, 0, line)
    assert.equal(grade.max, sport.ordinal('5c+'), line)
    assert.equal(grade.written, 'fino a 5c+', line)
  }
})

test('a floor on the alpine scale infers alpinismo, as fino a does', () => {
  assert.equal(only('sopra AD', 'grade').written, 'dal AD+ in su')
  assert.equal(only('sopra AD', 'activity').id, 'alpinismo')
  assert.equal(only('sopra AD', 'activity').inferred, true)
})

test('a comparison past the end of the scale is left as text, not clamped', () => {
  assert.equal(only('sopra 9a', 'name').text, 'sopra', 'the comparison is visibly unread')
  assert.equal(only('sopra 9a', 'grade').written, '9a', 'the grade alone still reads')
  assert.equal(only('sotto 3', 'name').text, 'sotto 3', 'a bare numeral is a grade only when the visitor said so')
})

test('a floor reads back through the parser unchanged', () => {
  const written = only('falesia oltre 7a', 'grade').written
  assert.equal(only(written, 'grade').written, written)
})

// ---------------------------------------------------------------------------
// Ranges

test('tra, fra and da … a read as a range, written back as dal … al', () => {
  for (const line of ['tra 6a e 7b', 'fra 6a e 7b', 'tra il 6a e il 7b', 'da 6a a 7b', 'dal 6a a 7b', 'tra 7b e 6a']) {
    const grade = only(line, 'grade')
    assert.equal(grade.min, sport.ordinal('6a'), line)
    assert.equal(grade.max, sport.ordinal('7b'), line)
    assert.equal(grade.written, 'dal 6a al 7b', line)
  }
})

test('a bare digit inside a range is its whole family, taken widest', () => {
  assert.equal(only('falesia tra 6A e 7', 'grade').written, 'dal 6a al 7c+')
  assert.equal(only('tra 6 e 7', 'grade').written, 'dal 6a al 7c+')
  assert.equal(only('tra 7 e 6', 'grade').written, 'dal 6a al 7c+', 'either way round')
  assert.equal(only('dal 7 in su', 'grade').written, 'dal 7a in su')
  assert.equal(only('fino al 7', 'grade').written, 'fino a 7c+')
})

test('excluding a family excludes all of it', () => {
  assert.equal(only('sopra 7', 'grade').written, 'dal 8a in su')
  assert.equal(only('sotto 7', 'grade').written, 'fino a 6c+')
})

test('a bare digit outside a written form is still not a grade', () => {
  assert.deepEqual(kinds('Pilastro 7'), ['name'])
})

test('the two grade menus post ends the parser reads back', () => {
  assert.equal(only('dal 6a al 7b', 'grade').written, 'dal 6a al 7b')
  assert.equal(only('dal 6a', 'grade').written, 'dal 6a in su', 'the top left open')
  assert.equal(only('al 7b', 'grade').written, 'fino a 7b', 'the bottom left open')
})

test('a range that reaches an end of the scale is written as the open form', () => {
  assert.equal(only('dal 3 al 7b', 'grade').written, 'fino a 7b')
  assert.equal(only('dal 6a al 9a', 'grade').written, 'dal 6a in su')
})

// ---------------------------------------------------------------------------
// Another activity's grade and features

test('a fact phrase under another activity cannot apply, and is dropped', () => {
  assert.deepEqual(parse('alpinismo con la pioggia', VOCAB).map(c => c.kind), ['activity'])
  assert.deepEqual(parse('alpinismo con la pioggia quando piove', VOCAB).map(c => c.kind), ['activity'])
})

test('a grade on a scale the typed activity does not use cannot apply, and is dropped', () => {
  // What the sentence posts when its activity menu moves from falesie to
  // alpinismo with the crag's grade and features set: the visitor changed the
  // activity and expects them gone, not reported back as unread words.
  assert.deepEqual(parse('alpinismo dal 6a al 7b', VOCAB).map(c => c.kind), ['activity'])
  assert.deepEqual(parse('Alpinismo per famiglie dal 6a al 7c+', VOCAB).map(c => c.kind), ['activity'])
  assert.equal(only('falesia dal 6a al 7b', 'grade').scale, 'sport', 'under its own activity it applies')
  assert.equal(only('alpinismo fino a AD', 'grade').scale, 'alpine')
})

test('words nobody could read are still kept beside a dropped grade', () => {
  assert.equal(only('alpinismo dal 6a al 7b zqxwibble', 'name').text, 'zqxwibble')
})

// ---------------------------------------------------------------------------
// Exposure, approach, number of routes

test('an exposure is asked of every activity with an aspect, and names none of them', () => {
  const fact = only('esposte a sud', 'fact')
  assert.deepEqual([fact.activities, fact.id, fact.value], [['alpinismo', 'falesia'], 'esposizione', 'S'])
  assert.equal(parse('esposte a sud', VOCAB).some(c => c.kind === 'activity'), false, 'shared, so nothing is inferred')
})

test('under a typed activity a shared exposure narrows to it', () => {
  assert.deepEqual(only('falesia esposta a sud-est', 'fact').activities, ['falesia'])
  assert.equal(only('falesia esposizione sudest', 'fact').value, 'SE')
  assert.deepEqual(only('alpinismo esposte a nord', 'fact').activities, ['alpinismo'])
})

test('a bare compass word stays part of a name', () => {
  assert.deepEqual(kinds('Spigolo Sud'), ['name'])
})

test('approach and number of routes are thresholds, and imply falesia', () => {
  const approach = only('con avvicinamento entro 10 min', 'fact')
  assert.deepEqual([approach.id, approach.match, approach.value], ['avvicinamento', 'atMost', 10])
  const routes = only('almeno 20 vie', 'fact')
  assert.deepEqual([routes.id, routes.match, routes.value], ['vie', 'atLeast', 20])
  assert.equal(only('almeno 20 vie', 'activity').id, 'falesia')
  assert.equal(parse('almeno 20 vie', VOCAB).some(c => c.kind === 'grade'), false, 'almeno 20 is no grade')
})

// ---------------------------------------------------------------------------
// Asking words and nearby

test('the words that ask or join are not a name', () => {
  assert.deepEqual(kinds('Cerco una falesia a Torino'), ['activity', 'place'])
  assert.deepEqual(kinds('vorrei falesia'), ['activity'])
})

test('joining words inside a name are kept, the asking word is not', () => {
  assert.equal(only('Cerco Cresta del Colletto', 'name').text, 'Cresta del Colletto')
})

test('vicino a, nei dintorni di and non lontano da are a radius of NEARBY_KM', () => {
  for (const line of ['vicino a Torino', 'vicino Torino', 'nei dintorni di Torino', 'non lontano da Torino', 'in zona Torino']) {
    const near = only(line, 'near')
    assert.deepEqual([near.placeName, near.withinKm], ['Torino', NEARBY_KM], line)
  }
})

test('a season is read as a noun as well as an adjective', () => {
  for (const line of ['falesia estate', 'falesia in estate', 'falesia d’estate', 'falesia estiva', 'falesie estive']) {
    const fact = only(line, 'fact')
    assert.deepEqual([fact.id, fact.value], ['stagione', 'estate'], line)
  }
  assert.equal(only('falesia inverno', 'fact').value, 'inverno')
})

// ---------------------------------------------------------------------------
// Wall, conditions, dry spells

test('a wall angle is a falesia fact, in the plural the sentence reads', () => {
  for (const [line, value] of [['strapiombanti', 'strapiombante'], ['in strapiombo', 'strapiombante'],
    ['su placca', 'placca'], ['verticali', 'verticale'], ['con tetti', 'tetto']] as const) {
    const fact = only(line, 'fact')
    assert.deepEqual([fact.id, fact.value], ['parete', value], line)
    assert.equal(only(line, 'activity').id, 'falesia', line)
  }
})

test('in condizione is no longer read: the words are kept, visibly unread', () => {
  // Nothing grades a route any more, so there is nothing for the phrase to ask.
  // Reading it as some other question would answer one the visitor did not ask.
  for (const line of ['falesia in condizione', 'in piena condizione', 'in buone condizioni']) {
    const name = parse(line, VOCAB).find(c => c.kind === 'name')
    assert.match(name?.kind === 'name' ? name.text : '', /condizion/, line)
  }
})

test('a dry spell is read in days, up to what the weather can see', () => {
  for (const line of ['senza pioggia da 3 giorni', 'non piove da 3 giorni', 'asciutta da almeno 3 giorni', 'falesia asciutte da 3 gg']) {
    const dry = only(line, 'dry')
    assert.deepEqual([dry.days, dry.written], [3, 'senza pioggia da 3 giorni'], line)
  }
  assert.equal(only('senza pioggia da 1 giorno', 'dry').written, 'senza pioggia da 1 giorno')
  assert.equal(parse('senza pioggia da 10 giorni', VOCAB).some(c => c.kind === 'dry'), false,
    'beyond the seven days cached, not read as seven')
})

test('an activity reads as the sentence writes it, and as one of them', () => {
  for (const line of ['vie di alpinismo', 'una via di alpinismo', 'falesie', 'una falesia']) {
    const cs = parse(line, VOCAB)
    assert.deepEqual(cs.map(c => c.kind), ['activity'], line)
  }
})

test('dry with no count is a dry spell of the default length, not a name', () => {
  for (const line of ['una falesia asciutta', 'alpinismo senza pioggia', 'falesia non piove', 'asciutto']) {
    const dry = only(line, 'dry')
    assert.deepEqual([dry.days, dry.written], [DRY_DEFAULT_DAYS, dryWritten(DRY_DEFAULT_DAYS)], line)
    assert.equal(parse(line, VOCAB).some(c => c.kind === 'name'), false, line)
  }
  assert.equal(only('asciutta da 5 giorni', 'dry').days, 5, 'a count still wins')
})

// ---------------------------------------------------------------------------
// Every comune in the archive

test('a town is forgiven a slip only when asked to be', () => {
  // With every comune held, ordinary words sit one letter from a town:
  // Cresta from Cressa, Cerco from Cervo. Find asks this only as a fallback.
  assert.deepEqual(kinds('Torine'), ['name'])
})

test('a name of one or two letters is read only as written', () => {
  const withProvinces: Vocabulary = { ...VOCAB, places: [...VOCAB.places, { id: 'no', name: 'NO' }, { id: 'si', name: 'SI' }] }
  assert.deepEqual(parse('falesia NO', withProvinces).map(c => c.kind).sort(), ['activity', 'place'])
  assert.deepEqual(parse('no pioggia', withProvinces).map(c => c.kind), ['name'], 'no is not Novara')
  assert.deepEqual(parse('si', withProvinces).map(c => c.kind), ['name'], 'si is not Siena')
})

test('grado before a grade is part of it, not the comune in Friuli', () => {
  const withGrado: Vocabulary = { ...VOCAB, places: [...VOCAB.places, { id: 'grado', name: 'Grado' }] }
  const cs = parse('falesia di grado dal 6a in su', withGrado)
  assert.deepEqual(cs.map(c => c.kind).sort(), ['activity', 'grade'])
  assert.deepEqual(parse('falesia grado 6b', withGrado).map(c => c.kind).sort(), ['activity', 'grade'])
  assert.deepEqual(parse('falesia Grado', withGrado).map(c => c.kind).sort(), ['activity', 'place'], 'alone, it is the town')
})

// ---------------------------------------------------------------------------
// The misreadings study, 16 November 2026

const TOWNS: Vocabulary = {
  ...VOCAB,
  places: [...VOCAB.places,
    { id: 'grado', name: 'Grado' }, { id: 'ora', name: 'Ora' }, { id: 'bella', name: 'Bella' },
    { id: 'carcare', name: 'Carcare' }, { id: 'canale', name: 'Canale' }, { id: 'susa', name: 'Susa' },
    { id: 'valsusa', name: 'Val di Susa' }],
}
const read = (line: string, vocabulary = TOWNS) => parse(line, vocabulary)
const kindsOf = (line: string, vocabulary = TOWNS) => read(line, vocabulary).map(c => c.kind).sort()
const gradeOf = (line: string, vocabulary = TOWNS) => {
  const g = read(line, vocabulary).find(c => c.kind === 'grade')
  return g?.kind === 'grade' ? g.written : null
}

test('a common word that is also a comune is the word, unless written as a place', () => {
  for (const line of ['alpinismo fattibile ora', 'falesia bella', 'alpinismo III grado', 'falesia calcare']) {
    assert.equal(read(line).some(c => c.kind === 'place'), false, line)
  }
  assert.equal(read('falesia calcare', TOWNS).some(c => c.kind === 'place'), false, 'calcare is not forgiven into Carcare')
  assert.equal(parse('falesia calcare', TOWNS, { forgivePlaces: true }).some(c => c.kind === 'place'), false,
    'not even when Find forgives towns a slip')
  assert.deepEqual(kindsOf('falesia Bella'), ['activity', 'place'], 'capitalised, it is the town')
  assert.deepEqual(kindsOf('falesia a bella'), ['activity', 'place'], 'introduced as a place, it is the town')
  assert.deepEqual(kindsOf('falesia vicino a Ora'), ['activity', 'near'])
})

test('grado before a bare digit is that digit’s family of grades', () => {
  assert.equal(gradeOf('falesia grado 5'), 'dal 5a al 5c+')
})

test('a span written as one word, and a bound written after its grade', () => {
  assert.equal(gradeOf('falesia 6a-6c'), 'dal 6a al 6c')
  assert.equal(gradeOf('falesia 6a/6c'), 'dal 6a al 6c')
  assert.equal(gradeOf('falesia 7a max'), 'fino a 7a')
  assert.equal(gradeOf('falesia max 6a'), 'fino a 6a')
  assert.equal(gradeOf('falesia massimo 6a+'), 'fino a 6a+')
  assert.equal(gradeOf('falesia 6b o più'), 'dal 6b in su')
  assert.equal(gradeOf('alpinismo AD-'), 'AD-', 'a grade ending in a sign is not a span')
})

test('an alpine grade with no sign is its band', () => {
  assert.equal(gradeOf('alpinismo PD', { ...TOWNS, places: [] }), 'dal PD- al PD+')
  assert.equal(gradeOf('alpinismo AD+'), 'AD+')
})

test('difficulty in words is a band of the activity’s own scale', () => {
  assert.equal(gradeOf('falesia facile'), 'fino a 5c+')
  assert.equal(gradeOf('falesie per principianti'), 'fino a 5c+')
  assert.equal(gradeOf('falesia non troppo difficile'), 'dal 6a al 6b+')
  assert.equal(gradeOf('falesia difficile'), 'dal 7a in su')
  assert.equal(gradeOf('alpinismo facile'), 'fino a PD+')
  assert.equal(gradeOf('alpinismo poco difficile'), 'dal PD- al PD+', 'PD is poco difficile')
  assert.equal(gradeOf('alpinismo abbastanza difficile'), 'dal AD- al AD+')
  assert.deepEqual(kindsOf('una cresta facile'), ['name'], 'with no activity, facile asks about nothing in particular')
})

test('sun, shade and a direction without esposta', () => {
  const aspect = (line: string) => {
    const f = read(line).find(c => c.kind === 'fact')
    return f?.kind === 'fact' ? f.value : null
  }
  assert.equal(aspect('falesia al sole'), 'S')
  assert.equal(aspect("falesia all'ombra"), 'N')
  assert.equal(aspect('falesia a sud'), 'S')
  assert.equal(aspect('falesia esposta a sud est'), 'SE')
  assert.deepEqual(kindsOf('alpinismo nord'), ['activity', 'name'], 'a bare direction is still a route name')
})

test('a radius however it is introduced, and a valley however it is spelt', () => {
  for (const line of ['falesia a meno di 50 km da Torino', 'falesia a 50 km da Torino', 'falesia 50 km da Torino']) {
    const near = only(line.replace('falesia ', ''), 'near')
    assert.equal(near.withinKm, 50, line)
    assert.equal(near.loose, undefined, `${line}: a figure the visitor wrote is theirs`)
  }
  assert.equal(only('vicino a Torino', 'near').loose, true)
  for (const line of ['falesia Valsusa', 'falesia Val Susa', 'falesia Valle di Susa', 'falesia in Valle Susa']) {
    const place = read(line).find(c => c.kind === 'place')
    assert.equal(place?.kind === 'place' ? place.name : null, 'Val di Susa', line)
  }
})

test('other words for an activity, and words that only ask', () => {
  for (const [line, id] of [['arrampicata sportiva', 'falesia'], ['via alpinistica', 'alpinismo'],
                            ['vie alpinistiche', 'alpinismo'], ['dove posso arrampicare', 'falesia']] as const) {
    assert.deepEqual(read(line).map(c => c.kind === 'activity' ? c.id : c.kind), [id], line)
  }
})

test('the facts a climber names in everyday words', () => {
  const fact = (line: string) => {
    const f = read(line).find(c => c.kind === 'fact')
    return f?.kind === 'fact' ? `${f.id}:${f.match}:${String(f.value)}` : null
  }
  assert.equal(fact('falesia avvicinamento breve'), 'avvicinamento:atMost:10')
  assert.equal(fact('falesia con tante vie'), 'vie:atLeast:20')
  assert.equal(fact('falesia per bambini'), 'per_famiglie:is:true')
  assert.equal(fact('falesia riparata dalla pioggia'), 'con_la_pioggia:is:true')
  assert.equal(fact('alpinismo in giornata'), 'giorni:atMost:1')
  assert.equal(fact('alpinismo dislivello sotto i 1000 m'), 'dislivello:atMost:1000')
  assert.equal(fact('alpinismo sopra i 3000 m'), 'vetta:atLeast:3000')
})

test('a crag’s rock, however a climber names it', () => {
  const rock = (line: string) => {
    const f = read(line).find(c => c.kind === 'fact')
    return f?.kind === 'fact' && f.id === 'roccia' ? f.value : null
  }
  assert.equal(rock('falesia su calcare'), 'calcare')
  assert.equal(rock('falesia calcare'), 'calcare', 'the rock, not Carcare')
  assert.equal(rock('falesie calcaree'), 'calcare')
  assert.equal(rock('falesia granitica'), 'granito')
  assert.equal(rock('falesia di gneiss'), 'gneiss')
  assert.deepEqual(kindsOf('su granito'), ['activity', 'fact'], 'a rock names the crag activity on its own')
})

test('multipitch is its own activity, and arrampicata still finds it, not a crag', () => {
  const vocabulary: Vocabulary = { ...TOWNS, activities: [...TOWNS.activities, { id: 'multipitch', label: 'Multipitch' }] }
  const ids = (line: string) => read(line, vocabulary).map(c => c.kind === 'activity' ? c.id : c.kind)
  assert.deepEqual(ids('multipitch'), ['multipitch'])
  assert.deepEqual(ids('vie multipitch'), ['multipitch'])
  assert.deepEqual(ids('arrampicata'), ['multipitch'], 'the old name is a word for it')
  assert.deepEqual(ids('arrampicata sportiva'), ['falesia'])
})
