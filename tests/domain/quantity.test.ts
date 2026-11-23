import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  metres, minutes, count, text, aspect, timeOfDay, gradeScale, rangeOf, QuantityError, boolean,
  stars, wallAngle, wallAngles, seasons, gradeSteps, sportGradeBand, protection,
} from '../../src/domain/quantity.ts'

test('metres parses integers and formats in Italian', () => {
  assert.equal(metres.parse(3841), 3841)
  assert.equal(metres.format(3841), '3841 m')
  assert.throws(() => metres.parse('alto'), QuantityError)
  assert.throws(() => metres.parse(-1), QuantityError)
})

test('minutes formats as an approach time', () => {
  assert.equal(minutes.format(20), '20 min')
})

test('aspect parses a compass point and formats it in Italian', () => {
  assert.equal(aspect.parse('SE'), 'SE')
  assert.equal(aspect.format('SE'), 'Sud-Est')
  assert.equal(aspect.format('S'), 'Sud')
  assert.throws(() => aspect.parse('SW'), QuantityError, 'compass points are Italian: SO not SW')
})

test('an inherited property name is not a compass point', () => {
  for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
    assert.throws(() => aspect.parse(name), QuantityError)
  }
})

test('timeOfDay round-trips a 24-hour time', () => {
  assert.equal(timeOfDay.parse('17:10'), '17:10')
  assert.equal(timeOfDay.format('17:10'), '17:10')
  assert.throws(() => timeOfDay.parse('25:00'), QuantityError)
})

test('a range of clock times is ordered by the clock, not by Number()', () => {
  // Number('13:30') is NaN, and NaN > NaN is false: without an ordinal an
  // inverted span of times would parse without complaint.
  const shade = rangeOf(timeOfDay)
  assert.deepEqual(shade.parse(['13:30', '17:00']), ['13:30', '17:00'])
  assert.equal(shade.format(['13:30', '17:00']), '13:30 a 17:00')
  assert.throws(() => shade.parse(['17:00', '13:30']), QuantityError)
})

test('the alpine grade scale is ordered', () => {
  const alpine = gradeScale('alpine')
  assert.equal(alpine.parse('AD'), 'AD')
  assert.ok(alpine.ordinal('AD') > alpine.ordinal('PD+'))
  assert.ok(alpine.ordinal('TD') > alpine.ordinal('AD'))
  assert.throws(() => alpine.parse('6a'), QuantityError, 'sport grades are a different scale')
})

test('the sport grade scale is ordered', () => {
  const sport = gradeScale('sport')
  assert.ok(sport.ordinal('7c') > sport.ordinal('6a+'))
  assert.ok(sport.ordinal('6a+') > sport.ordinal('6a'))
})

test('rangeOf formats a span and rejects an inverted one', () => {
  const grades = rangeOf(gradeScale('sport'))
  assert.equal(grades.format(['6a', '7c']), '6a a 7c')
  assert.equal(rangeOf(metres).format([14, 34]), '14 a 34 m')
  assert.throws(() => rangeOf(metres).parse([34, 14]), QuantityError)
})

test('count formats bare', () => {
  assert.equal(count.format(22), '22')
})

test('text rejects an empty string, because a nameless via is a data error', () => {
  assert.equal(text.parse('Primo sole'), 'Primo sole')
  assert.throws(() => text.parse(''), QuantityError)
  assert.throws(() => text.parse(42), QuantityError)
})

test('boolean parses true and false', () => {
  assert.equal(boolean.parse(true), true)
  assert.equal(boolean.parse(false), false)
})

test('boolean rejects anything else', () => {
  assert.throws(() => boolean.parse('true'))
  assert.throws(() => boolean.parse(1))
  assert.throws(() => boolean.parse(null))
})

test('boolean formats as Sì/No', () => {
  assert.equal(boolean.format(true), 'Sì')
  assert.equal(boolean.format(false), 'No')
})

test('stars are whole numbers from one to five', () => {
  assert.equal(stars.parse(1), 1)
  assert.equal(stars.parse(5), 5)
  assert.equal(stars.format(4), '4 su 5')
  for (const bad of [0, 6, 4.5, '4', null]) {
    assert.throws(() => stars.parse(bad), /stars: expected a whole number from 1 to 5/)
  }
})

test('a wall angle is one of four, ordered slab to roof', () => {
  assert.equal(wallAngle.parse('strapiombante'), 'strapiombante')
  assert.equal(wallAngle.format('strapiombante'), 'Strapiombante')
  assert.deepEqual(['tetto', 'placca', 'verticale'].map(a => wallAngle.ordinal(wallAngle.parse(a))), [3, 0, 1])
  assert.throws(() => wallAngle.parse('strapiombo'), /wallAngle: expected one of placca, verticale, strapiombante, tetto/)
})

test('a crag’s wall angles are a set, stored slab to roof, read as one capitalised line', () => {
  assert.deepEqual(wallAngles.parse(['strapiombante', 'placca']), ['placca', 'strapiombante'])
  assert.equal(wallAngles.format(wallAngles.parse(['strapiombante', 'placca'])), 'Placca, strapiombante')
  assert.deepEqual(wallAngles.parse('verticale'), ['verticale'], 'a single angle stored as a string still reads')
  assert.throws(() => wallAngles.parse([]), /wallAngles: expected a non-empty list/)
  assert.throws(() => wallAngles.parse(['placca', 'placca']), /names an angle twice/)
  assert.throws(() => wallAngles.parse(['strapiombo']), /"strapiombo" is not one of placca/)
})

test('a season set is stored in calendar order, whatever order it was written in', () => {
  assert.deepEqual(seasons.parse(['inverno', 'autunno']), ['autunno', 'inverno'])
})

test('a season set refuses nothing, strangers and repeats rather than tidying them', () => {
  assert.throws(() => seasons.parse([]), /seasons: expected a non-empty list/)
  assert.throws(() => seasons.parse('estate'), /seasons: expected a non-empty list/)
  assert.throws(() => seasons.parse(['estate', 'monsone']), /"monsone" is not one of primavera, estate, autunno, inverno/)
  assert.throws(() => seasons.parse(['estate', 'estate']), /names a season twice/)
})

test('a season set reads from after its gap, as a climber says it', () => {
  const read = (s: string[]) => seasons.format(seasons.parse(s))
  assert.equal(read(['autunno', 'inverno', 'primavera']), 'Autunno, inverno, primavera')
  assert.equal(read(['estate']), 'Estate')
  assert.equal(read(['primavera', 'estate']), 'Primavera, estate')
  assert.equal(read(['inverno', 'primavera']), 'Inverno, primavera')
})

test('two season sets have a word of their own', () => {
  assert.equal(seasons.format(seasons.parse(['primavera', 'autunno'])), 'Mezze stagioni')
  assert.equal(seasons.format(seasons.parse(['primavera', 'estate', 'autunno', 'inverno'])), "Tutto l’anno")
})

test('a split set with no single gap reads in calendar order', () => {
  assert.equal(seasons.format(seasons.parse(['inverno', 'estate'])), 'Estate, inverno')
})

test('no two steps of one grade scale differ only by letter case, so the importer may read 5C as 5c', () => {
  for (const system of ['sport', 'alpine'] as const) {
    const folded = gradeSteps(system).map(s => s.toLowerCase())
    assert.equal(new Set(folded).size, folded.length, system)
  }
})

test('a sport grade is banded by its number alone, as on a gym\'s circuits', () => {
  assert.deepEqual(['3', '4a', '5c+', '6a', '6c+', '7a+', '8b', '9a'].map(sportGradeBand), [3, 4, 5, 6, 6, 7, 8, 9])
})

test('an alpine grade or anything off the sport scale has no band', () => {
  assert.deepEqual(['AD+', '6d', '', '—'].map(sportGradeBand), [null, null, null, null])
})

test('protection is one of three, and reads in Italian', () => {
  assert.equal(protection.format(protection.parse('da_integrare')), 'Da integrare')
  assert.throws(() => protection.parse('mista'), /protection: expected one of spittata, da_integrare, trad/)
})
