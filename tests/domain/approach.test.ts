import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkProposal, sentences, sortApproach } from '../../src/domain/approach.ts'

test('sentences, joined again, are the text exactly', () => {
  const text = 'Da Condove salire a Mocchie. (Svolta a DX) Raggiunta la borgata,parcheggiate.  Poi a piedi!'
  assert.equal(sentences(text).join(''), text)
  assert.equal(sentences(text).length, 3)
})

test('the drive and the parking come out ahead of the first sentence on foot', () => {
  assert.deepEqual(sortApproach(
    'Parcheggiare l’auto nel parcheggio panoramico. Imboccare il sentiero che scende. 10 minuti dall’auto.'), {
    access: 'Parcheggiare l’auto nel parcheggio panoramico.',
    parking: null,
    approach: 'Imboccare il sentiero che scende. 10 minuti dall’auto.',
  })
})

test('sentences after the parking that are still about the road stay with it', () => {
  const sorted = sortApproach(
    'Dopo pochi minuti compare uno spiazzo, parcheggiate. Se andaste oltre trovate una sbarra. '
    + 'Percorrere a piedi la sterrata per 15 minuti.')
  assert.equal(sorted.access, 'Dopo pochi minuti compare uno spiazzo, parcheggiate. Se andaste oltre trovate una sbarra.')
  assert.equal(sorted.approach, 'Percorrere a piedi la sterrata per 15 minuti.')
})

test('a text with parking and nothing on foot is all access', () => {
  assert.deepEqual(sortApproach('Entrare nel borgo. Meglio parcheggiare nel borgo che sotto le pareti.'), {
    access: 'Entrare nel borgo. Meglio parcheggiare nel borgo che sotto le pareti.', parking: null, approach: null,
  })
})

test('a walk that starts from the parking is a walk, not a drive', () => {
  for (const text of ['Due ore dal parcheggio, con un tratto di pietraia.',
                      'Sentiero a monte del parcheggio, poi traccia nel vallone.',
                      'Un’ora dal piazzale.']) {
    assert.deepEqual(sortApproach(text), { access: null, parking: null, approach: text })
  }
})

test('nothing about the road ahead of the walk: the text stays an approach', () => {
  const text = 'Dal ponte si risale il greto. Poi traccia a destra.'
  assert.deepEqual(sortApproach(text), { access: null, parking: null, approach: text })
})

// --- a model's proposal, checked

const TEXT = 'Da Condove salire a Mocchie. Si lascia il mezzo nello spiazzo.  Percorrere la sterrata. Poi il bosco.'

test('a proposal that is the text cut up is kept, with the parking apart from the road', () => {
  assert.deepEqual(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Si lascia il mezzo nello spiazzo.', to: 'parking' },
    { text: 'Percorrere la sterrata.', to: 'walk' },
    { text: 'Poi il bosco.', to: 'walk' },
  ]), {
    access: 'Da Condove salire a Mocchie.',
    parking: 'Si lascia il mezzo nello spiazzo.',
    approach: 'Percorrere la sterrata. Poi il bosco.',
  }, 'the rule could not have told: "il mezzo" names neither a car nor a parking')
})

test('sentences kept side by side keep what stood between them, even nothing', () => {
  const text = 'Parcheggiate.  Sentiero della Memoria.Salire e in 5 minuti la falesia.'
  assert.deepEqual(checkProposal(text, [
    { text: 'Parcheggiate.', to: 'parking' },
    { text: 'Sentiero della Memoria.', to: 'walk' },
    { text: 'Salire e in 5 minuti la falesia.', to: 'walk' },
  ]), { access: null, parking: 'Parcheggiate.', approach: 'Sentiero della Memoria.Salire e in 5 minuti la falesia.' },
  'the author wrote no space there, and none is added')
})

test('a proposal with a word changed is refused', () => {
  assert.equal(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Si lascia l’auto nello spiazzo.', to: 'parking' },
    { text: 'Percorrere la sterrata. Poi il bosco.', to: 'walk' },
  ]), null)
})

test('a proposal that drops a sentence, or repeats one, is refused', () => {
  assert.equal(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Percorrere la sterrata. Poi il bosco.', to: 'walk' },
  ]), null, 'dropped')
  assert.equal(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Si lascia il mezzo nello spiazzo.  Percorrere la sterrata. Poi il bosco.', to: 'walk' },
  ]), null, 'repeated')
  assert.equal(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie. Si lascia il mezzo nello spiazzo.', to: 'road' },
  ]), null, 'the rest left over')
})

test('a proposal out of order, or one that parks after walking, is refused', () => {
  assert.equal(checkProposal(TEXT, [
    { text: 'Si lascia il mezzo nello spiazzo.', to: 'parking' },
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Percorrere la sterrata. Poi il bosco.', to: 'walk' },
  ]), null, 'out of order')
  assert.equal(checkProposal(TEXT, [
    { text: 'Da Condove salire a Mocchie.', to: 'road' },
    { text: 'Si lascia il mezzo nello spiazzo.', to: 'walk' },
    { text: 'Percorrere la sterrata.', to: 'parking' },
    { text: 'Poi il bosco.', to: 'walk' },
  ]), null, 'parked after setting off')
})

test('an empty proposal, or an empty sentence in one, is refused', () => {
  assert.equal(checkProposal(TEXT, []), null)
  assert.equal(checkProposal(TEXT, [{ text: '  ', to: 'road' }, { text: TEXT, to: 'walk' }]), null)
})
